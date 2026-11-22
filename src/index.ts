import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";

import { OpenQuestionnaire, registerAnswerChannel } from "./answer-channel.js";
import { getConfigPath, loadConfig, setActiveConfig } from "./config.js";
import { ASK_USER_BLOCKED_EVENT, ASK_USER_PROMPT_EVENT } from "./events.js";
import { t } from "./i18n.js";
import { normalizeQuestionParams, prepareQuestionArguments } from "./normalize.js";
import { renderAskCall, renderAskResult } from "./render.js";
import { createSettingsProvider } from "./settings.js";
import { exposeSettings } from "./shizuku-settings.js";
import { closeReplay, setReplayHost } from "./replay.js";
import { buildEnvelope, errorResult, type ToolResult } from "./result.js";
import { hasDialogUI, runRpcQuestionnaire, type DialogUI } from "./rpc.js";
import {
	PROMPT_GUIDELINES,
	PROMPT_SNIPPET,
	QuestionParamsSchema,
	TOOL_DESCRIPTION,
	TOOL_NAME,
	type QuestionParams,
} from "./schema.js";
import { loadTui } from "./tui-loader.js";
import type { AskParams, QuestionnaireResult } from "./types.js";
import { validateQuestionnaire } from "./validate.js";

const NO_UI_MESSAGE =
	"Error: UI not available (running in non-interactive mode). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead.";
const NO_CUSTOM_UI_MESSAGE =
	"Error: this client cannot render the questionnaire. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead.";

function emitPrompt(pi: ExtensionAPI, toolCallId: string, params: AskParams): void {
	pi.events.emit(ASK_USER_PROMPT_EVENT, {
		toolCallId,
		questions: params.questions.map((question) => ({
			question: question.question,
			header: question.header,
			multiSelect: question.multiSelect === true,
			options: question.options.map((option) => ({
				label: option.label,
				description: option.description,
				hasPreview: Boolean(option.preview),
			})),
		})),
	});
}

function emitBlocked(pi: ExtensionAPI, toolCallId: string, active: boolean): void {
	pi.events.emit(ASK_USER_BLOCKED_EVENT, { active, toolCallId });
}

async function runTui(
	ctx: ExtensionToolContext,
	params: AskParams,
	open: OpenQuestionnaire,
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	let result: QuestionnaireResult | undefined;
	try {
		const { QuestionnaireComponent, emptyComponent } = await loadTui();
		result = await ctx.ui.custom<QuestionnaireResult | undefined>(
			(tui, theme, _keybindings, done) => {
				open.attach(done);
				if (open.settled) return emptyComponent();
				return new QuestionnaireComponent(tui, theme, params.questions, (settled) => open.settle(settled), signal);
			},
			{ blocked: { kind: "question", message: t("ask.waiting") } },
		);
	} catch (error) {
		if (open.settled) return open.settled;
		// Degrade visibly: a bug in the dialog must not hide behind the fallback.
		const message = error instanceof Error ? error.message : String(error);
		if (typeof ctx.ui.notify === "function") ctx.ui.notify(t("fallback.dialogs", { error: message }), "warning");
	}
	if (result !== undefined) return result;
	// Hosts without custom components resolve `custom()` to undefined.
	if (open.settled) return open.settled;
	open.host = "rpc";
	return runRpc(ctx, params, signal);
}

async function runRpc(
	ctx: ExtensionToolContext,
	params: AskParams,
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	if (!hasDialogUI(ctx.ui)) {
		return { answers: [], cancelled: true, error: "no_custom_ui" };
	}
	return runRpcQuestionnaire(ctx.ui as DialogUI, params.questions, signal);
}

/**
 * Hide the tool while no UI exists, and restore it only if this plugin hid
 * it: a user (`--tools`, settings) or another extension may have turned it
 * off deliberately, and that choice must stand.
 */
function createToolReconciler(pi: ExtensionAPI): (ctx: ExtensionContext) => void {
	let hiddenForNoUI = false;
	return (ctx) => {
		const active = pi.getActiveTools();
		const present = active.includes(TOOL_NAME);
		if (!ctx.hasUI) {
			if (present) {
				pi.setActiveTools(active.filter((name) => name !== TOOL_NAME));
				hiddenForNoUI = true;
			}
			return;
		}
		if (hiddenForNoUI) {
			hiddenForNoUI = false;
			if (!present) pi.setActiveTools([...active, TOOL_NAME]);
		}
	};
}

export default function askUserPlugin(pi: ExtensionAPI): void {
	const configPath = getConfigPath();
	setActiveConfig(loadConfig(configPath));
	exposeSettings(pi, createSettingsProvider(configPath));
	const answers = registerAnswerChannel(pi);
	const reconcileTool = createToolReconciler(pi);

	// Transcript rows reopen answered questionnaires on click, which needs a UI to open them in.
	const trackReplayHost = (ctx: ExtensionContext) => setReplayHost(ctx.hasUI && ctx.mode === "tui" ? ctx.ui : undefined);
	pi.on("session_start", (_event, ctx) => trackReplayHost(ctx));

	pi.on("before_agent_start", (_event, ctx) => {
		reconcileTool(ctx);
		trackReplayHost(ctx);
		if (ctx.hasUI && ctx.mode === "tui") void loadTui().catch(() => undefined);
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Ask User Question",
		description: TOOL_DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,
		prepareArguments: prepareQuestionArguments,
		executionMode: "sequential",
		// Drawn without pi's colored box so it lines up with the compact tool rows.
		renderShell: "self",
		async execute(
			toolCallId: string,
			rawParams: QuestionParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<ToolResult> {
			const params = normalizeQuestionParams(rawParams as AskParams);
			const validation = validateQuestionnaire(params);
			if (!validation.ok) return errorResult(validation.error, validation.message);
			if (!ctx.hasUI) return errorResult("no_ui", NO_UI_MESSAGE);

			const host = ctx.mode === "rpc" ? "rpc" : "tui";
			// A replay left open would sit under the live dialog and reappear after it.
			closeReplay();
			const open = answers.open(toolCallId, params.questions, host);
			try {
				emitPrompt(pi, toolCallId, params);
				emitBlocked(pi, toolCallId, true);
				const result =
					host === "rpc"
						? await runRpc(ctx, params, signal)
						: await runTui(ctx, params, open, signal);
				if (result.error === "no_custom_ui") return errorResult(result.error, NO_CUSTOM_UI_MESSAGE);
				return buildEnvelope(params, result);
			} finally {
				answers.close(open);
				emitBlocked(pi, toolCallId, false);
			}
		},
		renderCall: renderAskCall,
		renderResult: renderAskResult,
	});
}
