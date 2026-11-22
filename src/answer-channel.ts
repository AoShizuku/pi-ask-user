import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	ASK_USER_ANSWER_EVENT,
	ASK_USER_ANSWER_RESULT_EVENT,
} from "./events.js";
import { sanitizeText } from "./normalize.js";
import type {
	AskAnswerRejectCode,
	AskAnswerResultEventPayload,
	AskQuestion,
	QuestionAnswer,
	QuestionnaireResult,
} from "./types.js";

export type AnswerHost = "tui" | "rpc";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OpenQuestionnaire {
	private result: QuestionnaireResult | undefined;
	private deliver: ((result: QuestionnaireResult) => void) | undefined;

	constructor(
		readonly toolCallId: string,
		readonly questions: readonly AskQuestion[],
		public host: AnswerHost,
	) {}

	get settled(): QuestionnaireResult | undefined {
		return this.result;
	}

	attach(done: (result: QuestionnaireResult) => void): void {
		this.deliver = done;
		if (this.result) done(this.result);
	}

	/** First answer wins. */
	settle(result: QuestionnaireResult): boolean {
		if (this.result) return false;
		this.result = result;
		this.deliver?.(result);
		return true;
	}
}

export type ExternalAnswerOutcome =
	| { ok: true; result: QuestionnaireResult }
	| { ok: false; code: AskAnswerRejectCode; reason: string };

const reject = (code: AskAnswerRejectCode, reason: string): ExternalAnswerOutcome => ({
	ok: false,
	code,
	reason,
});

/** External text is untrusted: strip terminal control sequences like authored text. */
function noteOf(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return sanitizeText(value) || undefined;
}

/**
 * Resolve an inbound external answer. Strict by design: a partly applied
 * answer would be indistinguishable from one the user gave in the UI.
 */
export function resolveExternalAnswer(
	questions: readonly AskQuestion[],
	payload: Record<string, unknown>,
): ExternalAnswerOutcome {
	const { cancel, globalNote } = payload;
	if (cancel !== undefined && typeof cancel !== "boolean") {
		return reject("invalid_payload", "cancel must be a boolean");
	}
	if (globalNote !== undefined && typeof globalNote !== "string") {
		return reject("invalid_payload", "globalNote must be a string");
	}
	const global = noteOf(globalNote);

	if (cancel === true) {
		if (payload.answers !== undefined && !(Array.isArray(payload.answers) && payload.answers.length === 0)) {
			return reject("invalid_payload", "cancel takes no answers");
		}
		return {
			ok: true,
			result: { answers: [], cancelled: true, ...(global ? { globalNote: global } : {}) },
		};
	}

	if (!Array.isArray(payload.answers)) {
		return reject("invalid_payload", "answers must be an array");
	}

	const byQuestion = new Map<number, Record<string, unknown>>();
	for (const raw of payload.answers) {
		if (!isRecord(raw)) return reject("invalid_payload", "each answer must be an object");
		const index = raw.questionIndex;
		if (!Number.isInteger(index)) return reject("invalid_payload", "questionIndex must be an integer");
		const questionIndex = index as number;
		if (questionIndex < 0 || questionIndex >= questions.length) {
			return reject("invalid_answer", `questionIndex ${questionIndex} is out of range`);
		}
		if (byQuestion.has(questionIndex)) {
			return reject("invalid_answer", `question ${questionIndex} was answered twice`);
		}
		byQuestion.set(questionIndex, raw);
	}
	if (byQuestion.size !== questions.length) {
		return reject("invalid_answer", "every question must be answered exactly once");
	}

	const answers: QuestionAnswer[] = [];
	for (let index = 0; index < questions.length; index += 1) {
		const question = questions[index]!;
		const raw = byQuestion.get(index)!;
		const optionIndexes = raw.optionIndexes;
		const text = raw.text;
		const notes = raw.notes;
		if (optionIndexes !== undefined && !Array.isArray(optionIndexes)) {
			return reject("invalid_payload", "optionIndexes must be an array");
		}
		if (text !== undefined && typeof text !== "string") {
			return reject("invalid_payload", "text must be a string");
		}
		if (notes !== undefined && typeof notes !== "string") {
			return reject("invalid_payload", "notes must be a string");
		}
		const indexes = (optionIndexes ?? []) as unknown[];
		if (!indexes.every((value) => Number.isInteger(value))) {
			return reject("invalid_payload", "optionIndexes must contain integers");
		}
		const selected = indexes as number[];
		if (new Set(selected).size !== selected.length) {
			return reject("invalid_answer", `question ${index} repeats an option index`);
		}
		for (const optionIndex of selected) {
			if (optionIndex < 0 || optionIndex >= question.options.length) {
				return reject("invalid_answer", `option index ${optionIndex} is out of range for question ${index}`);
			}
		}
		const custom = typeof text === "string" ? sanitizeText(text) : "";
		if (typeof text === "string" && custom.length === 0) {
			return reject("invalid_answer", `question ${index} has blank custom text`);
		}
		if (selected.length === 0 && !custom) {
			return reject("invalid_answer", `question ${index} has no answer`);
		}
		const note = noteOf(notes);

		if (question.multiSelect) {
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "multi",
				answer: custom || null,
				selected: selected
					.slice()
					.sort((left, right) => left - right)
					.map((optionIndex) => question.options[optionIndex]!.label),
				...(note ? { notes: note } : {}),
			});
			continue;
		}

		if (selected.length > 1) {
			return reject("invalid_answer", `question ${index} is single-select but has multiple options`);
		}
		if (selected.length === 1 && custom) {
			return reject("invalid_answer", `question ${index} mixes an option and custom text`);
		}
		if (selected.length === 1) {
			const option = question.options[selected[0]!]!;
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "option",
				answer: option.label,
				...(option.preview ? { preview: option.preview } : {}),
				...(note ? { notes: note } : {}),
			});
		} else {
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "custom",
				answer: custom,
				...(note ? { notes: note } : {}),
			});
		}
	}

	return {
		ok: true,
		result: { answers, cancelled: false, ...(global ? { globalNote: global } : {}) },
	};
}

export interface AnswerChannel {
	open(toolCallId: string, questions: readonly AskQuestion[], host: AnswerHost): OpenQuestionnaire;
	close(questionnaire: OpenQuestionnaire): void;
}

export function registerAnswerChannel(pi: ExtensionAPI): AnswerChannel {
	const open = new Map<string, OpenQuestionnaire>();

	pi.events.on(ASK_USER_ANSWER_EVENT, (data: unknown) => {
		const payload = isRecord(data) ? data : {};
		const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
		const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined;
		const reply = (code?: AskAnswerRejectCode, reason?: string) => {
			const verdict: AskAnswerResultEventPayload = {
				ok: code === undefined,
				...(code ? { code, reason } : {}),
				...(toolCallId ? { toolCallId } : {}),
				...(requestId ? { requestId } : {}),
			};
			pi.events.emit(ASK_USER_ANSWER_RESULT_EVENT, verdict);
		};

		if (!isRecord(data)) return reply("invalid_payload", "payload must be an object");
		if (payload.requestId !== undefined && requestId === undefined) {
			return reply("invalid_payload", "requestId must be a string");
		}
		if (!toolCallId) return reply("invalid_payload", "toolCallId must be a string");
		const target = open.get(toolCallId);
		if (!target || target.settled) {
			return reply("not_found", `no open questionnaire for tool call ${toolCallId}`);
		}
		if (target.host === "rpc") {
			return reply("unsupported_host", "this host renders the questions in its own dialogs");
		}

		const outcome = resolveExternalAnswer(target.questions, payload);
		if (!outcome.ok) return reply(outcome.code, outcome.reason);
		if (!target.settle(outcome.result)) {
			return reply("not_found", `tool call ${toolCallId} is already answered`);
		}
		reply();
	});

	return {
		open(toolCallId, questions, host) {
			const questionnaire = new OpenQuestionnaire(toolCallId, questions, host);
			open.set(toolCallId, questionnaire);
			return questionnaire;
		},
		close(questionnaire) {
			if (open.get(questionnaire.toolCallId) === questionnaire) open.delete(questionnaire.toolCallId);
		},
	};
}
