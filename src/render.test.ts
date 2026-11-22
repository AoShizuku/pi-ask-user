import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openReplay = vi.fn((_args: unknown, _details: unknown) => true);
vi.mock("./replay.js", () => ({ openReplay: (args: unknown, details: unknown) => openReplay(args, details) }));

import { answerRows, renderAskCall, renderAskResult } from "./render.js";
import type { QuestionnaireResult } from "./types.js";

const TAGGED = new Set(["accent", "success", "error", "warning"]);
/** Tags each colored span so colors are visible in assertions. */
const theme = {
	fg: (color: string, text: string) => (TAGGED.has(color) ? `<${color}>${text}` : text),
	bold: (text: string) => text,
} as unknown as Theme;

const one = { questions: [{ question: "Which?", header: "Pick", options: [] }] };
const three = {
	questions: [
		{ question: "Which database should we use?", header: "Database", options: [] },
		{ question: "Which features ship first?", header: "Features", options: [] },
		{ question: "Where do we deploy?", header: "Deploy", options: [] },
	],
};

interface RowInput {
	details?: QuestionnaireResult;
	text?: string;
	isError?: boolean;
	partial?: boolean;
}

function component(args: object, result?: RowInput, options: { outputPad?: number; expanded?: boolean } = {}) {
	const context = {
		state: {},
		expanded: options.expanded ?? false,
		isError: result?.isError ?? false,
		outputPad: options.outputPad ?? 1,
		lastComponent: undefined,
	} as never;
	const row = renderAskCall(args as never, theme, context);
	if (result) {
		renderAskResult(
			{ content: [{ type: "text", text: result.text ?? "" }], details: result.details } as never,
			{ expanded: options.expanded ?? false, isPartial: result.partial ?? false },
			theme,
			context,
		);
	}
	return row;
}

function row(args: object, result?: RowInput, options: { outputPad?: number; expanded?: boolean; width?: number } = {}) {
	return component(args, result, options).render(options.width ?? 200);
}

const answered: QuestionnaireResult = {
	answers: [{ questionIndex: 0, question: "Which?", kind: "option", answer: "A" }],
	cancelled: false,
};

const full: QuestionnaireResult = {
	answers: [
		{ questionIndex: 0, question: "Which database should we use?", kind: "option", answer: "Postgres", notes: "managed" },
		{ questionIndex: 1, question: "Which features ship first?", kind: "multi", answer: "SSO", selected: ["Auth", "Search"] },
		{ questionIndex: 2, question: "Where do we deploy?", kind: "custom", answer: "my own\nVPS" },
	],
	cancelled: false,
};

beforeEach(() => openReplay.mockClear());

describe("ask tool row", () => {
	it("draws a bash-style header in column 0 while waiting, whatever the outputPad", () => {
		expect(row(one)).toEqual(["<accent>● Ask (1 question)"]);
		expect(row(one, undefined, { outputPad: 2 })).toEqual(["<accent>● Ask (1 question)"]);
		expect(row(one, { details: answered, partial: true })).toEqual(["<accent>● Ask (1 question)"]);
	});

	it("puts the answered count on the title line and one row per question under it", () => {
		expect(row(one, { details: answered })).toEqual(["<success>● Ask · <success>1 answered", "  └ Pick  <success>A"]);
	});

	it("aligns headers, marks free text with ✎, and flags notes", () => {
		expect(row(three, { details: full })).toEqual([
			"<success>● Ask · <success>3 answered",
			"  ├ Database  <success>Postgres + note",
			"  ├ Features  <success>Auth, Search, ✎ SSO",
			"  └ Deploy    <success>✎ my own VPS",
		]);
	});

	it("shows a partial answer in warning color and the skipped question dim", () => {
		const partial: QuestionnaireResult = { answers: [full.answers[0]!, full.answers[2]!], cancelled: false, unanswered: [1] };
		expect(row(three, { details: partial })).toEqual([
			"<success>● Ask · <warning>2/3 answered",
			"  ├ Database  <success>Postgres + note",
			"  ├ Features  ○ skipped",
			"  └ Deploy    <success>✎ my own VPS",
		]);
	});

	it("draws a note-only submit as a response, not a decline, and keeps the note", () => {
		const noteOnly: QuestionnaireResult = { answers: [], cancelled: false, unanswered: [0, 1, 2], globalNote: "decide for me" };
		expect(row(three, { details: noteOnly })).toEqual([
			"<success>● Ask · <warning>0/3 answered",
			"  ├ Database  ○ skipped",
			"  ├ Features  ○ skipped",
			"  ├ Deploy    ○ skipped",
			"  └ note      decide for me",
		]);
	});

	it("ends with the global note row", () => {
		const lines = row(one, { details: { ...answered, globalNote: "ship fast" } });
		expect(lines.slice(1)).toEqual(["  ├ Pick  <success>A", "  └ note  ship fast"]);
	});

	it("keeps every row on one line, truncating the answer but not the note flag", () => {
		const long: QuestionnaireResult = {
			answers: [{ ...full.answers[0]!, answer: "x".repeat(200) }],
			cancelled: false,
		};
		// Real colors are zero-width; the tagging theme's tags would eat into the width.
		const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
		const lines = answerRows(three as never, long, plain, 40, false);
		expect(lines).toHaveLength(3);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		expect(lines[0]!.replace(/\x1b\[[0-9;]*m/g, "")).toMatch(/^ {2}├ Database {2}x+… \+ note$/);
	});

	it("wraps the full question, answer, and note under the header when expanded", () => {
		expect(row(three, { details: full }, { expanded: true })).toEqual([
			"<success>● Ask · <success>3 answered",
			"  ├ Database  Which database should we use?",
			"  │           <success>Postgres",
			"  │           note: managed",
			"  ├ Features  Which features ship first?",
			"  │           <success>Auth, Search, ✎ SSO",
			"  └ Deploy    Where do we deploy?",
			"              <success>✎ my own VPS",
		]);
	});

	it("turns red and says declined when nothing was answered", () => {
		expect(row(one, { details: { answers: [], cancelled: true } })).toEqual(["<error>● Ask (1 question) · <error>declined"]);
		expect(row(one, { details: { answers: [], cancelled: false } })).toEqual(["<error>● Ask (1 question) · <error>declined"]);
	});

	it("turns red on an error and shows its first line", () => {
		expect(row(one, { text: "Error: bad input\nmore", isError: true })).toEqual(["<error>● Ask (1 question)", "  <error>Error: bad input"]);
	});
});

describe("clicking the ask row", () => {
	const click = { type: "click", button: "left", x: 0, y: 0 } as never;

	it("reopens a finished questionnaire, declined ones included", () => {
		expect(component(three, { details: full }).handleMouse?.(click)).toEqual({ handled: true });
		expect(openReplay).toHaveBeenCalledWith(three, full);
		const declined = { answers: [], cancelled: true };
		expect(component(one, { details: declined }).handleMouse?.(click)).toEqual({ handled: true });
	});

	it("leaves waiting and failed rows, and other buttons, to pi", () => {
		expect(component(one).handleMouse?.(click)).toBeUndefined();
		expect(component(one, { text: "Error", isError: true }).handleMouse?.(click)).toBeUndefined();
		expect(component(one, { details: answered }).handleMouse?.({ type: "click", button: "right", x: 0, y: 0 } as never)).toBeUndefined();
		expect(openReplay).not.toHaveBeenCalled();
	});

	it("falls through when no replay could open", () => {
		openReplay.mockReturnValueOnce(false);
		expect(component(one, { details: answered }).handleMouse?.(click)).toBeUndefined();
	});
});
