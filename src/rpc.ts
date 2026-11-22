import { t } from "./i18n.js";
import type { AskQuestion, QuestionAnswer, QuestionnaireResult } from "./types.js";

export interface DialogUI {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
}

export function hasDialogUI(ui: unknown): ui is DialogUI {
	const candidate = ui as Partial<Record<"select" | "input", unknown>> | null | undefined;
	return typeof candidate?.select === "function" && typeof candidate?.input === "function";
}

function optionLine(label: string, description: string, index: number): string {
	return `${index + 1}. ${label}${description ? ` — ${description}` : ""}`;
}

function previewBlock(question: AskQuestion): string {
	const blocks = question.options.flatMap((option, index) =>
		option.preview ? [`--- ${index + 1}. ${option.label} preview ---\n${option.preview.slice(0, 600)}`] : [],
	);
	return blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
}

function resolveSingleReply(
	chosen: string,
	rows: readonly string[],
	question: AskQuestion,
): number | undefined {
	const exact = rows.indexOf(chosen);
	if (exact >= 0) return exact;
	const trimmed = chosen.trim();
	if (/^\d+\.?$/.test(trimmed)) {
		const index = Number.parseInt(trimmed, 10) - 1;
		if (index >= 0 && index < question.options.length + 1) return index;
	}
	const label = question.options.findIndex((option) => option.label === trimmed);
	return label >= 0 ? label : undefined;
}

/**
 * Parse `1,3; custom`. All-numeric selections must be in range (undefined asks
 * again); anything else is taken verbatim as free text.
 */
export function parseMultiReply(
	reply: string,
	optionCount: number,
): { selected: number[]; custom: string } | undefined {
	const [selectionPart = "", ...customParts] = reply.split(";");
	const tokens = selectionPart.split(/[,\s，、]+/).filter(Boolean);
	if (tokens.length === 0 || !tokens.every((token) => /^\d+\.?$/.test(token))) {
		return { selected: [], custom: reply };
	}
	const indexes = tokens.map((token) => Number.parseInt(token, 10) - 1);
	if (!indexes.every((value) => value >= 0 && value < optionCount)) return undefined;
	return {
		selected: [...new Set(indexes)].sort((left, right) => left - right),
		custom: customParts.join(";").trim(),
	};
}

function collect(answers: QuestionAnswer[], questions: readonly AskQuestion[], cancelled: boolean): QuestionnaireResult {
	const answered = new Set(answers.map((answer) => answer.questionIndex));
	const unanswered = questions.map((_question, index) => index).filter((index) => !answered.has(index));
	return {
		answers,
		cancelled,
		...(unanswered.length > 0 ? { unanswered } : {}),
	};
}

/**
 * Sequential native-dialog walker for RPC/ACP hosts. No tabs, notes, or
 * side-by-side previews; those primitives do not exist there.
 */
export async function runRpcQuestionnaire(
	ui: DialogUI,
	questions: readonly AskQuestion[],
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	const answers: QuestionAnswer[] = [];

	for (let index = 0; index < questions.length; index += 1) {
		if (signal?.aborted) return collect(answers, questions, true);
		const question = questions[index]!;
		const header = question.header ? `[${question.header}] ` : "";
		const rows = question.options.map((option, optionIndex) => optionLine(option.label, option.description, optionIndex));
		rows.push(`${question.options.length + 1}. ◌ ${t("sentinel.typeSomething")}`);
		const title = `${header}${question.question}${previewBlock(question)}`;

		if (question.multiSelect) {
			const list = question.options.map((option, optionIndex) => optionLine(option.label, option.description, optionIndex)).join("\n");
			let retry = "";
			for (;;) {
				if (signal?.aborted) return collect(answers, questions, true);
				const value = await ui.input(
					`${title}\n\n${list}\n\n${retry}${t("custom.title")} (1,3; text)`,
					"1,3; custom",
					signal ? { signal } : undefined,
				);
				if (value === undefined) return collect(answers, questions, true);
				const trimmed = value.trim();
				if (!trimmed) break;
				const reply = parseMultiReply(trimmed, question.options.length);
				if (reply === undefined) {
					retry = `${t("rpc.invalidSelection", { max: question.options.length })}\n`;
					continue;
				}
				answers.push({
					questionIndex: index,
					question: question.question,
					kind: "multi",
					answer: reply.custom || null,
					selected: reply.selected.map((valueIndex) => question.options[valueIndex]!.label),
				});
				break;
			}
			continue;
		}

		for (;;) {
			const chosen = await ui.select(title, rows, signal ? { signal } : undefined);
			if (chosen === undefined) return collect(answers, questions, true);
			const reply = chosen.trim();
			if (!reply) return collect(answers, questions, true);
			const resolved = resolveSingleReply(chosen, rows, question);
			if (resolved !== undefined) {
				if (resolved < question.options.length) {
					const option = question.options[resolved]!;
					answers.push({
						questionIndex: index,
						question: question.question,
						kind: "option",
						answer: option.label,
						...(option.preview ? { preview: option.preview } : {}),
					});
					break;
				}
				const typed = await ui.input(
					`${title}\n\n${question.options.map((option, optionIndex) => optionLine(option.label, option.description, optionIndex)).join("\n")}\n\n${t("custom.title")}:`,
					"",
					signal ? { signal } : undefined,
				);
				if (typed === undefined || !typed.trim()) continue;
				answers.push({
					questionIndex: index,
					question: question.question,
					kind: "custom",
					answer: typed.trim(),
				});
				break;
			}
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "custom",
				answer: reply,
			});
			break;
		}
	}

	return collect(answers, questions, false);
}
