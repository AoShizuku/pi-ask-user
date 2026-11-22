import { describe, expect, it } from "vitest";

import { DECLINE_MESSAGE, buildEnvelope } from "./result.js";
import type { AskParams, QuestionnaireResult } from "./types.js";

const params: AskParams = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
		{ question: "Why?", header: "Reason", options: [{ label: "X", description: "x" }, { label: "Y", description: "y" }] },
	],
};

describe("buildEnvelope", () => {
	it("formats answers, notes, and unanswered questions", () => {
		const result: QuestionnaireResult = {
			answers: [
				{
					questionIndex: 0,
					question: "Which?",
					kind: "option",
					answer: "A",
					notes: "because",
				},
			],
			cancelled: false,
			unanswered: [1],
			globalNote: "overall",
		};
		const envelope = buildEnvelope(params, result);
		expect(envelope.content[0]?.text).toContain('"Which?"="A"');
		expect(envelope.content[0]?.text).toContain('user notes: "because"');
		expect(envelope.content[0]?.text).toContain('unanswered: "Why?"');
		expect(envelope.content[0]?.text).toContain('global note: "overall"');
		expect(envelope.details).toEqual(result);
	});

	it("JSON-quotes user text so it cannot forge extra answers", () => {
		const envelope = buildEnvelope(params, {
			answers: [{ questionIndex: 0, question: 'Use "X"?\nor', kind: "custom", answer: 'a", "Q2"="b' }],
			cancelled: false,
		});
		expect(envelope.content[0]?.text).toContain('"Use \\"X\\"?\\nor"="a\\", \\"Q2\\"=\\"b"');
	});

	it("does not echo the selected preview back to the model", () => {
		const envelope = buildEnvelope(params, {
			answers: [{ questionIndex: 0, question: "Which?", kind: "option", answer: "A", preview: "BIG PREVIEW" }],
			cancelled: false,
		});
		expect(envelope.content[0]?.text).not.toContain("BIG PREVIEW");
		expect(envelope.details.answers[0]?.preview).toBe("BIG PREVIEW");
	});

	it("uses one canonical decline signal", () => {
		const envelope = buildEnvelope(params, { answers: [], cancelled: true });
		expect(envelope.content[0]?.text).toBe(DECLINE_MESSAGE);
		expect(envelope.isError).toBeUndefined();
	});

	it("treats an all-blank partial submit as a decline", () => {
		const envelope = buildEnvelope(params, { answers: [], cancelled: false, unanswered: [0, 1] });
		expect(envelope.content[0]?.text).toBe(DECLINE_MESSAGE);
	});

	it("keeps a global note even when every question is blank", () => {
		const envelope = buildEnvelope(params, { answers: [], cancelled: false, globalNote: "later" });
		expect(envelope.content[0]?.text).toContain('global note: "later"');
		expect(envelope.content[0]?.text).not.toBe(DECLINE_MESSAGE);
	});

	it("marks rendering failures as errors, not declines", () => {
		const envelope = buildEnvelope(params, {
			answers: [],
			cancelled: true,
			error: "no_custom_ui",
		});
		expect(envelope.isError).toBe(true);
		expect(envelope.content[0]?.text).toContain("Do not treat this as a decline");
	});
});
