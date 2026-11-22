// The `ask` tool row, drawn with renderShell: "self" so it lines up with pi's compact tool rows.
//
//   ● Ask · 3 answered                  status on the title line
//     ├ Database   Postgres             one row per question: aligned header, answer in green
//     ├ Features   Auth, Search
//     └ Deploy     ✎ my own VPS         ✎ marks text the user wrote
//
// Expanded (Ctrl+O), each row also carries the full question and its note. A click on a finished
// row reopens the questionnaire read-only (see replay.ts).
//
// renderCall returns one long-lived component that reads the shared renderer state at render time;
// renderResult only records the latest result there. The marker color depends on the result, and pi
// rebuilds the call component before the result one, so the header cannot be fixed at renderCall time.

import type { Theme, ThemeColor, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import { sanitizeText } from "./normalize.js";
import { openReplay } from "./replay.js";
import type { QuestionParams } from "./schema.js";
import type { AskParams, QuestionAnswer, QuestionnaireResult } from "./types.js";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;

interface RowResult {
	content: Array<{ type: string; text?: string }>;
	details?: QuestionnaireResult;
	isError: boolean;
	partial: boolean;
}

interface RowState {
	row?: AskRow;
	result?: RowResult;
}

const EMPTY: Component = { render: () => [], invalidate: () => {} };

/** Gutter convention (pi-shizuku README.md): markers sit in column 0, so rows ignore pi's outputPad. */
const MARKER_COLUMN = 0;
/** Space between the header column and the answer. */
const COLUMN_GAP = "  ";
const CUSTOM_MARK = "✎";
const GLOBAL_NOTE_HEADER = "note";

function textOf(result: Pick<RowResult, "content">): string {
	return result.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("\n");
}

function clean(value: unknown): string {
	return typeof value === "string" ? sanitizeText(value, true) : "";
}

/**
 * Whether the user responded: answered a question, or only left a global note. The note alone is a
 * real submit (the model receives it), not a decline, so it must not be drawn as one.
 */
export function hasResponse(details: QuestionnaireResult | undefined): boolean {
	if (!details || details.cancelled) return false;
	return details.answers.length > 0 || clean(details.globalNote).length > 0;
}

/** The answer as shown in the transcript: option labels as they are, free text marked with ✎. */
export function answerLabel(answer: QuestionAnswer): string {
	const custom = answer.answer ? `${CUSTOM_MARK} ${clean(answer.answer)}` : "";
	if (answer.kind === "option") return clean(answer.answer);
	if (answer.kind === "custom") return custom;
	return [...(answer.selected ?? []).map(clean), ...(custom ? [custom] : [])].join(", ");
}

interface Entry {
	header: string;
	question: string;
	answer?: QuestionAnswer;
}

function entriesOf(args: QuestionParams | undefined, details: QuestionnaireResult): Entry[] {
	const questions = Array.isArray(args?.questions) ? args.questions : [];
	const count = Math.max(questions.length, ...details.answers.map((answer) => answer.questionIndex + 1));
	return Array.from({ length: count }, (_unused, index) => {
		const question = questions[index];
		const answer = details.answers.find((candidate) => candidate.questionIndex === index);
		return {
			header: clean(question?.header) || `Q${index + 1}`,
			question: clean(question?.question) || clean(answer?.question),
			...(answer ? { answer } : {}),
		};
	});
}

/**
 * The rows under the title: `├`/`└` at column 2, headers padded to one column, answers after it.
 * Collapsed, every row is one line; expanded, the question, answer, and note wrap under the header.
 */
export function answerRows(
	args: QuestionParams | undefined,
	details: QuestionnaireResult,
	theme: Theme,
	width: number,
	expanded: boolean,
): string[] {
	const entries = entriesOf(args, details);
	const globalNote = clean(details.globalNote);
	const headers = [...entries.map((entry) => entry.header), ...(globalNote ? [GLOBAL_NOTE_HEADER] : [])];
	const headerWidth = Math.max(0, ...headers.map((header) => visibleWidth(header)));
	const total = headers.length;
	const lines: string[] = [];

	const row = (index: number, header: string, body: Array<{ text: string; color: (text: string) => string; suffix?: string }>) => {
		const last = index === total - 1;
		const rail = theme.fg("dim", `  ${last ? "└" : "├"} `);
		const label = theme.fg("muted", header + " ".repeat(Math.max(0, headerWidth - visibleWidth(header))));
		const lead = `${rail}${label}${COLUMN_GAP}`;
		const hang = theme.fg("dim", `  ${last ? " " : "│"} `) + " ".repeat(headerWidth) + COLUMN_GAP;
		const room = Math.max(1, width - visibleWidth(lead));
		if (!expanded) {
			const first = body[0]!;
			const suffix = first.suffix ?? "";
			const fitted = truncateToWidth(first.text, Math.max(1, room - visibleWidth(suffix)), "…");
			lines.push(truncateToWidth(`${lead}${first.color(fitted)}${suffix}`, width, "…"));
			return;
		}
		let prefix = lead;
		for (const part of body) {
			for (const line of wrapTextWithAnsi(part.text, room)) {
				lines.push(truncateToWidth(`${prefix}${part.color(line)}`, width, "…"));
				prefix = hang;
			}
		}
	};

	const answerColor = (text: string) => theme.fg("success", text);
	const skippedColor = (text: string) => theme.fg("dim", text);
	const noteColor = (text: string) => theme.fg("dim", text);
	entries.forEach((entry, index) => {
		const answer = entry.answer;
		const value = answer
			? { text: answerLabel(answer), color: answerColor }
			: { text: "○ skipped", color: skippedColor };
		const note = clean(answer?.notes);
		if (!expanded) {
			row(index, entry.header, [{ ...value, ...(note ? { suffix: theme.fg("dim", " + note") } : {}) }]);
			return;
		}
		row(index, entry.header, [
			...(entry.question ? [{ text: entry.question, color: (text: string) => text }] : []),
			value,
			...(note ? [{ text: `note: ${note}`, color: noteColor }] : []),
		]);
	});
	if (globalNote) row(total - 1, GLOBAL_NOTE_HEADER, [{ text: globalNote, color: (text: string) => theme.fg("muted", text) }]);
	return lines;
}

export class AskRow implements Component {
	args: QuestionParams | undefined;
	theme: Theme | undefined;
	expanded = false;
	pad = MARKER_COLUMN;

	constructor(private readonly state: RowState) {}

	render(width: number): string[] {
		const theme = this.theme;
		if (!theme || width <= 0) return [];
		const pad = " ".repeat(Math.max(0, this.pad));
		const result = this.state.result;
		const count = Array.isArray(this.args?.questions) ? this.args.questions.length : 0;
		const title = theme.fg("toolTitle", theme.bold("Ask"));
		const questions = theme.fg("muted", `(${count} ${count === 1 ? "question" : "questions"})`);
		const dot = theme.fg("muted", " · ");
		const header = (color: ThemeColor, rest: string) => truncateToWidth(`${pad}${theme.fg(color, "●")} ${title}${rest}`, width, "…");

		if (!result || result.partial) return [header("accent", ` ${questions}`)];
		if (result.isError) {
			const message = theme.fg("error", textOf(result).split("\n")[0] || "ask failed");
			const indent = `${pad}  `;
			const lines = [header("error", ` ${questions}`)];
			for (const line of wrapTextWithAnsi(message, Math.max(1, width - visibleWidth(indent)))) {
				lines.push(truncateToWidth(`${indent}${line}`, width, "…"));
			}
			return lines;
		}

		const details = result.details;
		if (!details || !hasResponse(details)) return [header("error", ` ${questions}${dot}${theme.fg("error", "declined")}`)];

		const answered = details.answers.length;
		const asked = Math.max(count, answered + (details.unanswered?.length ?? 0));
		const status =
			answered >= asked ? theme.fg("success", `${answered} answered`) : theme.fg("warning", `${answered}/${asked} answered`);
		const rows = answerRows(this.args, details, theme, Math.max(1, width - pad.length), this.expanded);
		return [header("success", `${dot}${status}`), ...rows.map((line) => `${pad}${line}`)];
	}

	/** A click on a finished row reopens the questionnaire read-only; anything else falls through to pi. */
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const result = this.state.result;
		if (!result || result.partial || result.isError || !result.details || result.details.error) return undefined;
		return openReplay(this.args as AskParams | undefined, result.details) ? { handled: true } : undefined;
	}

	invalidate(): void {
		// Everything is derived from the shared state at render time.
	}
}

export const renderAskCall: RenderCall = (args, theme, context) => {
	const state = context.state as RowState;
	const row = state.row ?? new AskRow(state);
	state.row = row;
	row.args = args as QuestionParams | undefined;
	row.theme = theme;
	row.expanded = context.expanded;
	row.pad = MARKER_COLUMN;
	return row;
};

export const renderAskResult: RenderResult = (result, options, theme, context) => {
	const state = context.state as RowState;
	state.result = {
		content: result.content as RowResult["content"],
		details: result.details as QuestionnaireResult | undefined,
		isError: context.isError,
		partial: options.isPartial,
	};
	if (state.row) {
		state.row.theme = theme;
		state.row.expanded = options.expanded;
		state.row.pad = MARKER_COLUMN;
	}
	return EMPTY;
};
