import { RESERVED_LABELS } from "./schema.js";
import type { AskParams, QuestionnaireError } from "./types.js";
import { MAX_HEADER_LENGTH, MAX_LABEL_LENGTH, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./types.js";

const MAX_QUESTION_LENGTH = 4_000;

const RESERVED = new Set(RESERVED_LABELS.map((label) => label.toLowerCase()));

function isReserved(label: string): boolean {
	return RESERVED.has(label.trim().toLowerCase());
}

export type ValidationResult =
	| { ok: true }
	| { ok: false; error: QuestionnaireError; message: string };

function fail(error: QuestionnaireError, message: string): ValidationResult {
	return { ok: false, error, message };
}

/** Semantic validation shared by the TUI and RPC paths. */
export function validateQuestionnaire(params: AskParams): ValidationResult {
	if (!Array.isArray(params.questions) || params.questions.length === 0) {
		return fail("no_questions", "Error: at least one question is required.");
	}
	if (params.questions.length > MAX_QUESTIONS) {
		return fail("too_many_questions", `Error: at most ${MAX_QUESTIONS} questions are allowed.`);
	}

	const seenQuestions = new Set<string>();
	for (const question of params.questions) {
		if (!question.question.trim()) {
			return fail("invalid_params", "Error: every question needs non-empty text.");
		}
		if (Array.from(question.question).length > MAX_QUESTION_LENGTH) {
			return fail("invalid_params", "Error: a question is too long (max 4000 characters).");
		}
		if (!question.header.trim()) {
			return fail("invalid_params", "Error: every question needs a non-empty header.");
		}
		if (Array.from(question.header).length > MAX_HEADER_LENGTH) {
			return fail("invalid_params", `Error: header must be at most ${MAX_HEADER_LENGTH} characters.`);
		}
		if (seenQuestions.has(question.question)) {
			return fail("duplicate_question", "Error: question text must be unique within one call.");
		}
		seenQuestions.add(question.question);

		if (!Array.isArray(question.options) || question.options.length < MIN_OPTIONS) {
			return fail("empty_options", `Error: every question needs at least ${MIN_OPTIONS} options.`);
		}
		if (question.options.length > MAX_OPTIONS) {
			return fail("invalid_params", `Error: every question allows at most ${MAX_OPTIONS} options.`);
		}

		const seenLabels = new Set<string>();
		for (const option of question.options) {
			if (!option.label.trim()) {
				return fail("invalid_params", "Error: every option needs a non-empty label.");
			}
			if (Array.from(option.label).length > MAX_LABEL_LENGTH) {
				return fail("invalid_params", `Error: option labels must be at most ${MAX_LABEL_LENGTH} characters.`);
			}
			if (isReserved(option.label)) {
				return fail(
					"reserved_label",
					'Error: "Other", "Type something.", and "Next" are reserved UI rows; do not author them.',
				);
			}
			if (seenLabels.has(option.label)) {
				return fail("duplicate_option_label", "Error: option labels must be unique within a question.");
			}
			seenLabels.add(option.label);
		}
	}

	return { ok: true };
}
