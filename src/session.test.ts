import { describe, expect, it } from "vitest";

import {
	answerSummary,
	answeredChoiceIndex,
	buildResult,
	chooseSingle,
	createSessionState,
	firstUnanswered,
	isAnswered,
	restoreSessionState,
	setCustom,
	setNotes,
	toggleMulti,
} from "./session.js";
import type { AskQuestion } from "./types.js";

const single: AskQuestion = {
	question: "Which?",
	header: "Pick",
	options: [
		{ label: "A", description: "a", preview: "```\nA\n```" },
		{ label: "B", description: "b" },
	],
};

const multi: AskQuestion = {
	question: "Which ones?",
	header: "Many",
	multiSelect: true,
	options: [
		{ label: "X", description: "x" },
		{ label: "Y", description: "y" },
		{ label: "Z", description: "z" },
	],
};

describe("session", () => {
	it("builds a single-select answer with preview", () => {
		const state = createSessionState([single]);
		chooseSingle(state, 0);
		expect(buildResult(state)).toEqual({
			answers: [
				{
					questionIndex: 0,
					question: "Which?",
					kind: "option",
					answer: "A",
					preview: "```\nA\n```",
				},
			],
			cancelled: false,
		});
	});

	it("custom text replaces a single selection", () => {
		const state = createSessionState([single]);
		chooseSingle(state, 1);
		setCustom(state, "  mine  ");
		expect(buildResult(state)).toEqual({
			answers: [{ questionIndex: 0, question: "Which?", kind: "custom", answer: "mine" }],
			cancelled: false,
		});
	});

	it("does not clear a single selection when custom text is blank", () => {
		const state = createSessionState([single]);
		chooseSingle(state, 0);
		setCustom(state, "");
		expect(buildResult(state).answers[0]).toMatchObject({ kind: "option", answer: "A" });
	});

	it("keeps selected options and custom text together for multi-select", () => {
		const state = createSessionState([multi]);
		toggleMulti(state, 2);
		toggleMulti(state, 0);
		setCustom(state, "also this");
		expect(buildResult(state)).toEqual({
			answers: [
				{
					questionIndex: 0,
					question: "Which ones?",
					kind: "multi",
					answer: "also this",
					selected: ["X", "Z"],
				},
			],
			cancelled: false,
		});
	});

	it("tracks unanswered questions and partial submissions", () => {
		const state = createSessionState([single, multi]);
		chooseSingle(state, 0);
		expect(isAnswered(state, 0)).toBe(true);
		expect(isAnswered(state, 1)).toBe(false);
		expect(firstUnanswered(state)).toBe(1);
		expect(buildResult(state)).toMatchObject({
			cancelled: false,
			unanswered: [1],
			answers: [{ questionIndex: 0, answer: "A" }],
		});
	});

	it("attaches notes without marking a question answered", () => {
		const state = createSessionState([single]);
		setNotes(state, "  why  ");
		expect(isAnswered(state, 0)).toBe(false);
		expect(buildResult(state).cancelled).toBe(true);
		chooseSingle(state, 0);
		expect(buildResult(state).answers[0]?.notes).toBe("why");
	});

	it("turns an all-blank submit into a decline, unless a global note exists", () => {
		const state = createSessionState([single]);
		expect(buildResult(state)).toMatchObject({ cancelled: true, answers: [] });
		state.globalNote = " later ";
		expect(buildResult(state)).toMatchObject({ cancelled: false, globalNote: "later", answers: [] });
	});

	it("summarizes answers for review", () => {
		const state = createSessionState([single, multi]);
		chooseSingle(state, 1);
		state.tab = 1;
		toggleMulti(state, 0);
		setCustom(state, "also");
		expect(answerSummary(single, state.answers[0]!)).toBe("B");
		expect(answerSummary(multi, state.answers[1]!)).toBe("X, also");
	});
});

describe("restoreSessionState", () => {
	const typed: AskQuestion = { ...single, question: "Typed?", header: "Typed" };

	it("rebuilds the drafts that produced a result", () => {
		const state = createSessionState([single, multi, typed]);
		chooseSingle(state, 1);
		setNotes(state, "because");
		state.tab = 1;
		toggleMulti(state, 2);
		toggleMulti(state, 0);
		setCustom(state, "W");
		state.tab = 2;
		setCustom(state, "my own");
		state.globalNote = "overall";
		const result = buildResult(state);

		const restored = restoreSessionState([single, multi, typed], result);
		expect(restored.answers).toEqual(state.answers);
		expect(restored.globalNote).toBe("overall");
		expect(buildResult(restored)).toEqual(result);
	});

	it("leaves skipped questions blank and declined results empty", () => {
		const state = createSessionState([single, multi]);
		chooseSingle(state, 0);
		const restored = restoreSessionState([single, multi], buildResult(state));
		expect(isAnswered(restored, 1)).toBe(false);
		const declined = restoreSessionState([single], { answers: [], cancelled: true });
		expect(declined.answers).toEqual([{ selected: [], custom: "", notes: "" }]);
	});

	it("keeps a label that no longer matches as free text", () => {
		const restored = restoreSessionState([single, multi], {
			answers: [
				{ questionIndex: 0, question: "Which?", kind: "option", answer: "Gone" },
				{ questionIndex: 1, question: "Which ones?", kind: "multi", answer: "extra", selected: ["Y", "Gone"] },
			],
			cancelled: false,
		});
		expect(restored.answers[0]).toEqual({ selected: [], custom: "Gone", notes: "" });
		expect(restored.answers[1]).toEqual({ selected: [1], custom: "Gone, extra", notes: "" });
	});

	it("rests the cursor on the answer", () => {
		expect(answeredChoiceIndex(single, { selected: [1], custom: "", notes: "" })).toBe(1);
		expect(answeredChoiceIndex(single, { selected: [], custom: "mine", notes: "" })).toBe(2);
		expect(answeredChoiceIndex(single, { selected: [], custom: "", notes: "" })).toBe(0);
	});
});
