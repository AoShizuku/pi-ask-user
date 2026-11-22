import { describe, expect, it } from "vitest";

import { deriveHeader, normalizeQuestionParams, prepareQuestionArguments } from "./normalize.js";
import type { AskParams } from "./types.js";

const options = [
	{ label: "Option A", description: "Does A." },
	{ label: "Option B", description: "Does B." },
];

function params(overrides: Partial<AskParams["questions"][number]> = {}): AskParams {
	return {
		questions: [{ question: "Which one?", header: "Choice", options, ...overrides }],
	};
}

describe("prepareQuestionArguments", () => {
	it("wraps a flat single question", () => {
		const prepared = prepareQuestionArguments({
			question: "Which one?",
			header: "Choice",
			options,
			multiSelect: true,
		});
		expect(prepared.questions).toHaveLength(1);
		expect(prepared.questions[0]?.question).toBe("Which one?");
		expect(prepared.questions[0]?.multiSelect).toBe(true);
	});

	it("moves header and options that sit beside a one-item questions array", () => {
		const prepared = prepareQuestionArguments({
			questions: [{ question: "Which one?" }],
			header: "Choice",
			options,
		});
		expect(prepared.questions[0]?.header).toBe("Choice");
		expect(prepared.questions[0]?.options).toHaveLength(2);
	});

	it("decodes double-encoded questions and options", () => {
		const prepared = prepareQuestionArguments({
			questions: JSON.stringify([{ question: "Which one?", header: "Choice", options: JSON.stringify(options) }]),
		});
		expect(prepared.questions[0]?.options[0]?.label).toBe("Option A");
	});

	it("derives a missing header from the question", () => {
		const prepared = prepareQuestionArguments({
			questions: [{ question: "Which database should we use?", options }],
		});
		expect(prepared.questions[0]?.header).toBe("Which database …");
		expect(Array.from(prepared.questions[0]?.header ?? "")).toHaveLength(16);
	});

	it("treats a plain-string questions value as a flat question", () => {
		const prepared = prepareQuestionArguments({ questions: "Which db?", options });
		expect(prepared.questions).toEqual([{ question: "Which db?", header: "Which db?", options }]);
	});

	it("never turns a JSON-encoded questions string into question text", () => {
		const prepared = prepareQuestionArguments({ questions: '[{"header":"x","options":[]}]' });
		expect(prepared.questions).toEqual([{ header: "x", options: [] }]);
	});

	it("coerces string booleans for multiSelect", () => {
		const prepared = prepareQuestionArguments({ questions: [{ question: "Q?", header: "H", options, multiSelect: "true" }] });
		expect(prepared.questions[0]?.multiSelect).toBe(true);
	});

	it("keeps limit violations and malformed items for the schema to reject", () => {
		const longHeader = "h".repeat(40);
		const prepared = prepareQuestionArguments({
			questions: [
				{ question: "Good?", header: longHeader, options },
				{ question: 12345, options: [] },
			],
		});
		expect(prepared.questions).toHaveLength(2);
		expect(prepared.questions[0]?.header).toBe(longHeader);
		expect(prepared.questions[1]).toEqual({ question: 12345, options: [] });
	});

	it("leaves authored text unsanitized until execution", () => {
		const prepared = prepareQuestionArguments({ questions: [{ question: "a\u001b[31mb", header: "H", options }] });
		expect(prepared.questions[0]?.question).toBe("a\u001b[31mb");
	});
});

describe("normalizeQuestionParams", () => {
	it("sanitizes control characters and ANSI", () => {
		const normalized = normalizeQuestionParams({
			questions: [
				{
					question: "\u001b[31mWhich\r\none?\u001b[0m\u009b",
					header: " Choice\n ",
					options: [
						{ label: " A\t", description: "Does\nA." },
						{ label: "B", description: "Does B." },
					],
				},
			],
		});
		expect(normalized.questions[0]?.question).toBe("Which\none?");
		expect(normalized.questions[0]?.header).toBe("Choice");
		expect(normalized.questions[0]?.options[0]).toEqual({ label: "A", description: "Does A." });
	});

	it("keeps options that sanitize to empty so validation reports them", () => {
		const normalized = normalizeQuestionParams(params({ options: [{ label: "\u001b[0m", description: "x" }, options[1]!] }));
		expect(normalized.questions[0]?.options).toHaveLength(2);
		expect(normalized.questions[0]?.options[0]?.label).toBe("");
	});

	it("drops previews from multi-select questions", () => {
		const normalized = normalizeQuestionParams(
			params({
				multiSelect: true,
				options: [
					{ label: "A", description: "a", preview: "preview" },
					{ label: "B", description: "b" },
				],
			}),
		);
		expect(normalized.questions[0]?.options[0]).toEqual({ label: "A", description: "a" });
	});

	it("trims and shapes a valid request", () => {
		const normalized = normalizeQuestionParams(params({ question: "  Which one?  ", header: " Choice " }));
		expect(normalized.questions[0]?.question).toBe("Which one?");
		expect(normalized.questions[0]?.header).toBe("Choice");
	});

	it("truncates previews on whole characters", () => {
		const normalized = normalizeQuestionParams(params({ options: [
			{ label: "A", description: "a", preview: "x".repeat(9_000) },
			{ label: "B", description: "b" },
		] }));
		expect(normalized.questions[0]?.options[0]?.preview?.endsWith("…")).toBe(true);
		expect(Array.from(normalized.questions[0]?.options[0]?.preview ?? "")).toHaveLength(8_000);
	});
});

describe("deriveHeader", () => {
	it("collapses whitespace and cuts on whole characters", () => {
		expect(deriveHeader("  Which   database?  ")).toBe("Which database?");
		expect(Array.from(deriveHeader("一二三四五六七八九十一二三四五六七八")).length).toBe(16);
	});
});
