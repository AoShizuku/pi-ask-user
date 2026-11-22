import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { registerAnswerChannel, resolveExternalAnswer } from "./answer-channel.js";
import { ASK_USER_ANSWER_EVENT, ASK_USER_ANSWER_RESULT_EVENT } from "./events.js";
import type { AskQuestion } from "./types.js";

const questions: AskQuestion[] = [
	{
		question: "Which?",
		header: "Pick",
		options: [
			{ label: "A", description: "a" },
			{ label: "B", description: "b", preview: "preview B" },
		],
	},
	{
		question: "Which ones?",
		header: "Many",
		multiSelect: true,
		options: [
			{ label: "X", description: "x" },
			{ label: "Y", description: "y" },
			{ label: "Z", description: "z" },
		],
	},
];

describe("resolveExternalAnswer", () => {
	it("accepts a complete single and multi answer", () => {
		const outcome = resolveExternalAnswer(questions, {
			answers: [
				{ questionIndex: 0, optionIndexes: [1] },
				{ questionIndex: 1, optionIndexes: [2, 0], text: "and this", notes: " why " },
			],
			globalNote: " overall ",
		});
		expect(outcome).toEqual({
			ok: true,
			result: {
				answers: [
					{ questionIndex: 0, question: "Which?", kind: "option", answer: "B", preview: "preview B" },
					{
						questionIndex: 1,
						question: "Which ones?",
						kind: "multi",
						answer: "and this",
						selected: ["X", "Z"],
						notes: "why",
					},
				],
				cancelled: false,
				globalNote: "overall",
			},
		});
	});

	it("strips terminal control sequences from external text", () => {
		const outcome = resolveExternalAnswer(questions, {
			answers: [
				{ questionIndex: 0, text: "\u001b[31mred\u001b[0m", notes: "\u001b]0;title\u0007n" },
				{ questionIndex: 1, optionIndexes: [0] },
			],
			globalNote: "g\u009b",
		});
		expect(outcome).toMatchObject({
			ok: true,
			result: { answers: [{ answer: "red", notes: "n" }, {}], globalNote: "g" },
		});
	});

	it("accepts custom single text and cancel", () => {
		expect(
			resolveExternalAnswer(questions, {
				answers: [
					{ questionIndex: 0, text: "mine" },
					{ questionIndex: 1, text: "many" },
				],
			}),
		).toMatchObject({ ok: true });
		expect(resolveExternalAnswer(questions, { cancel: true, globalNote: "later" })).toEqual({
			ok: true,
			result: { answers: [], cancelled: true, globalNote: "later" },
		});
	});

	it("rejects partial, duplicate, out-of-range, and mixed single answers", () => {
		expect(resolveExternalAnswer(questions, { answers: [{ questionIndex: 0, optionIndexes: [0] }] })).toMatchObject({
			ok: false,
			code: "invalid_answer",
		});
		expect(
			resolveExternalAnswer(questions, {
				answers: [
					{ questionIndex: 0, optionIndexes: [0] },
					{ questionIndex: 0, optionIndexes: [1] },
					{ questionIndex: 1, optionIndexes: [0] },
				],
			}),
		).toMatchObject({ ok: false, code: "invalid_answer" });
		expect(
			resolveExternalAnswer(questions, {
				answers: [
					{ questionIndex: 0, optionIndexes: [9] },
					{ questionIndex: 1, optionIndexes: [0] },
				],
			}),
		).toMatchObject({ ok: false, code: "invalid_answer" });
		expect(
			resolveExternalAnswer(questions, {
				answers: [
					{ questionIndex: 0, optionIndexes: [0], text: "mine" },
					{ questionIndex: 1, optionIndexes: [0] },
				],
			}),
		).toMatchObject({ ok: false, code: "invalid_answer" });
	});

	it("rejects malformed payloads", () => {
		expect(resolveExternalAnswer(questions, { cancel: "yes" })).toMatchObject({ ok: false, code: "invalid_payload" });
		expect(resolveExternalAnswer(questions, { answers: "nope" })).toMatchObject({ ok: false, code: "invalid_payload" });
		expect(
			resolveExternalAnswer(questions, {
				answers: [
					{ questionIndex: "0", optionIndexes: [0] },
					{ questionIndex: 1, optionIndexes: [0] },
				],
			}),
		).toMatchObject({ ok: false, code: "invalid_payload" });
	});
});

function fakePi() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	const results: unknown[] = [];
	const pi = {
		events: {
			on(channel: string, handler: (data: unknown) => void) {
				const list = handlers.get(channel) ?? [];
				list.push(handler);
				handlers.set(channel, list);
				return () => undefined;
			},
			emit(channel: string, data: unknown) {
				if (channel === ASK_USER_ANSWER_RESULT_EVENT) results.push(data);
				for (const handler of handlers.get(channel) ?? []) handler(data);
			},
		},
	} as unknown as ExtensionAPI;
	return { pi, results };
}

describe("answer channel", () => {
	it("settles an open TUI questionnaire once and reports later attempts", () => {
		const { pi, results } = fakePi();
		const channel = registerAnswerChannel(pi);
		const open = channel.open("call-1", questions, "tui");
		pi.events.emit(ASK_USER_ANSWER_EVENT, {
			toolCallId: "call-1",
			answers: [
				{ questionIndex: 0, optionIndexes: [0] },
				{ questionIndex: 1, optionIndexes: [1] },
			],
		});
		expect(open.settled?.answers).toHaveLength(2);
		expect(results[0]).toMatchObject({ ok: true, toolCallId: "call-1" });

		pi.events.emit(ASK_USER_ANSWER_EVENT, {
			toolCallId: "call-1",
			answers: [
				{ questionIndex: 0, optionIndexes: [1] },
				{ questionIndex: 1, optionIndexes: [0] },
			],
		});
		expect(results[1]).toMatchObject({ ok: false, code: "not_found" });
	});

	it("refuses external answers in RPC hosts", () => {
		const { pi, results } = fakePi();
		const channel = registerAnswerChannel(pi);
		channel.open("call-2", questions, "rpc");
		pi.events.emit(ASK_USER_ANSWER_EVENT, { toolCallId: "call-2", cancel: true });
		expect(results[0]).toMatchObject({ ok: false, code: "unsupported_host" });
	});
});
