import { describe, expect, it } from "vitest";

import type { AskParams } from "./types.js";
import { validateQuestionnaire } from "./validate.js";

const options = [
	{ label: "A", description: "a" },
	{ label: "B", description: "b" },
];

function params(questions: AskParams["questions"]): AskParams {
	return { questions };
}

describe("validateQuestionnaire", () => {
	it("accepts a normal request", () => {
		expect(validateQuestionnaire(params([{ question: "Which?", header: "Pick", options }]))).toEqual({ ok: true });
	});

	it("rejects empty and oversized questionnaires", () => {
		expect(validateQuestionnaire(params([]))).toMatchObject({ ok: false, error: "no_questions" });
		expect(
			validateQuestionnaire(
				params(Array.from({ length: 5 }, (_value, index) => ({ question: `Q${index}?`, header: "H", options }))),
			),
		).toMatchObject({ ok: false, error: "too_many_questions" });
	});

	it("rejects duplicate questions", () => {
		expect(
			validateQuestionnaire(
				params([
					{ question: "Same?", header: "A", options },
					{ question: "Same?", header: "B", options },
				]),
			),
		).toMatchObject({ ok: false, error: "duplicate_question" });
	});

	it("rejects too few and too many options", () => {
		expect(
			validateQuestionnaire(params([{ question: "Which?", header: "Pick", options: [options[0]!] }])),
		).toMatchObject({ ok: false, error: "empty_options" });
		expect(
			validateQuestionnaire(
				params([
					{
						question: "Which?",
						header: "Pick",
						options: [...options, { label: "C", description: "c" }, { label: "D", description: "d" }, { label: "E", description: "e" }],
					},
				]),
			),
		).toMatchObject({ ok: false, error: "invalid_params" });
	});

	it("rejects reserved and duplicate labels", () => {
		expect(
			validateQuestionnaire(
				params([{ question: "Which?", header: "Pick", options: [{ label: "Other", description: "x" }, options[1]!] }]),
			),
		).toMatchObject({ ok: false, error: "reserved_label" });
		expect(
			validateQuestionnaire(
				params([{ question: "Which?", header: "Pick", options: [{ label: "A", description: "x" }, { label: "A", description: "y" }] }]),
			),
		).toMatchObject({ ok: false, error: "duplicate_option_label" });
	});

	it("rejects long headers and labels", () => {
		expect(
			validateQuestionnaire(params([{ question: "Which?", header: "12345678901234567", options }])),
		).toMatchObject({ ok: false, error: "invalid_params" });
		expect(
			validateQuestionnaire(
				params([{ question: "Which?", header: "Pick", options: [{ label: "x".repeat(61), description: "x" }, options[1]!] }]),
			),
		).toMatchObject({ ok: false, error: "invalid_params" });
	});
});
