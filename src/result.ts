import type { AskParams, QuestionAnswer, QuestionnaireError, QuestionnaireResult } from "./types.js";

export const DECLINE_MESSAGE = "User declined to answer questions.";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: QuestionnaireResult;
	isError?: boolean;
}

export function buildToolResult(
	text: string,
	details: QuestionnaireResult,
	isError = false,
): ToolResult {
	return {
		content: [{ type: "text", text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

/** The answer as one string, or undefined when it holds nothing. */
function answerText(answer: QuestionAnswer): string | undefined {
	if (answer.kind !== "multi") return answer.answer ?? undefined;
	const parts = [...(answer.selected ?? [])];
	if (answer.answer && answer.answer.trim()) parts.push(answer.answer.trim());
	return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Model-facing text stays English and JSON-quoted so user text cannot forge structure. */
const quote = (text: string): string => JSON.stringify(text);

function answerSegment(answer: QuestionAnswer): string {
	const parts = [`${quote(answer.question)}=${quote(answerText(answer) ?? "(no answer)")}`];
	if (answer.notes) parts.push(`user notes: ${quote(answer.notes)}`);
	return `${parts.join(". ")}.`;
}

function unansweredSegment(params: AskParams, indexes: readonly number[]): string {
	const names = indexes.map((index) => quote(params.questions[index]?.question ?? ""));
	return `unanswered: ${names.join(", ")}.`;
}

/**
 * Build the model-facing text and the structured result. Cancelled and
 * all-blank results collapse to one canonical decline signal.
 */
export function buildEnvelope(params: AskParams, result: QuestionnaireResult): ToolResult {
	if (result.error) {
		return buildToolResult(
			`Error: ${result.error}. The user did not answer the questions. Do not treat this as a decline; ask in chat instead.`,
			result,
			true,
		);
	}
	if (result.cancelled) {
		return buildToolResult(DECLINE_MESSAGE, result);
	}

	if (result.answers.length === 0 && !result.globalNote) {
		return buildToolResult(DECLINE_MESSAGE, { ...result, cancelled: true });
	}

	const segments = result.answers.map(answerSegment);
	const unanswered = result.unanswered ?? [];
	if (unanswered.length > 0) segments.push(unansweredSegment(params, unanswered));
	if (result.globalNote) segments.push(`global note: ${quote(result.globalNote)}.`);

	return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, result);
}

export function errorResult(
	error: QuestionnaireError,
	message: string,
	extra: Partial<QuestionnaireResult> = {},
): ToolResult {
	return buildToolResult(message, { answers: [], cancelled: true, error, ...extra }, true);
}
