/** Limits shared by the tool schema, the runtime validator, and the UI. */
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;
export const MAX_PREVIEW_CHARS = 8_000;

/** One authored choice. `preview` is only rendered for single-select questions. */
export interface AskOption {
	label: string;
	description: string;
	preview?: string;
}

/** One structured question. The runtime appends the free-text and submit rows. */
export interface AskQuestion {
	question: string;
	header: string;
	options: AskOption[];
	multiSelect?: boolean;
}

/** The complete model-authored argument object. */
export interface AskParams {
	questions: AskQuestion[];
}

export type AnswerKind = "option" | "custom" | "multi";

/** One answer as returned to the model and to programmatic callers. */
export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: AnswerKind;
	/** Option label, custom text, or the custom part of a multi-select answer. */
	answer: string | null;
	/** Chosen option labels, multi-select only. */
	selected?: string[];
	/** Free-text note attached to this answer. */
	notes?: string;
	/** Markdown echoed back when the chosen option carried a preview. */
	preview?: string;
}

export type QuestionnaireError =
	| "no_ui"
	| "no_custom_ui"
	| "no_questions"
	| "too_many_questions"
	| "empty_options"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_label"
	| "invalid_params";

/** Structured result carried in `details` and in external events. */
export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	/** Note authored on the review tab. */
	globalNote?: string;
	/** Indexes of questions left blank on a partial submit. */
	unanswered?: number[];
	error?: QuestionnaireError;
}

export interface AskPromptOption {
	label: string;
	description: string;
	hasPreview: boolean;
}

export interface AskPromptQuestion {
	question: string;
	header: string;
	multiSelect: boolean;
	options: AskPromptOption[];
}

export interface AskPromptEventPayload {
	toolCallId: string;
	questions: AskPromptQuestion[];
}

export interface AskBlockedEventPayload {
	active: boolean;
	toolCallId: string;
}

export interface AskExternalAnswerEntry {
	questionIndex: number;
	optionIndexes?: number[];
	text?: string;
	notes?: string;
}

export interface AskExternalAnswerPayload {
	toolCallId: string;
	requestId?: string;
	answers?: AskExternalAnswerEntry[];
	globalNote?: string;
	cancel?: boolean;
}

export type AskAnswerRejectCode =
	| "not_found"
	| "invalid_payload"
	| "invalid_answer"
	| "unsupported_host";

export interface AskAnswerResultEventPayload {
	ok: boolean;
	code?: AskAnswerRejectCode;
	reason?: string;
	toolCallId?: string;
	requestId?: string;
}

/** Internal draft used by the session and the UI. */
export interface AnswerDraft {
	/** Zero-based indexes into `question.options`. */
	selected: number[];
	custom: string;
	notes: string;
}

export interface SessionState {
	questions: readonly AskQuestion[];
	/** 0..questions.length - 1 are question tabs; `questions.length` is the review tab. */
	tab: number;
	optionIndex: number;
	reviewIndex: number;
	answers: AnswerDraft[];
	globalNote: string;
	collapsed: boolean;
}
