import type { AskOption, AskParams, AskQuestion } from "./types.js";
import { MAX_HEADER_LENGTH, MAX_PREVIEW_CHARS } from "./types.js";

const OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** C0 controls except \t and \n, DEL, and C1 controls (8-bit CSI/OSC and friends). */
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

const QUESTION_KEYS = ["question", "header", "options", "multiSelect"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

/** A string that may hold a JSON array, as some models emit. */
function decodeArray(value: unknown): unknown {
	const parsed = typeof value === "string" ? parseJson(value) : value;
	return Array.isArray(parsed) ? parsed : value;
}

/** A string that may hold a JSON object, as some models emit. */
function decodeObject(value: unknown): unknown {
	const parsed = typeof value === "string" ? parseJson(value) : value;
	return isRecord(parsed) ? parsed : value;
}

export function sanitizeText(value: string, singleLine = false): string {
	let text = value.replace(OSC_PATTERN, "").replace(CSI_PATTERN, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
	text = text.replace(CONTROL_PATTERN, "");
	if (singleLine) text = text.replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ");
	return text.trim();
}

export function truncateCodePoints(value: string, max: number): string {
	const chars = Array.from(value);
	return chars.length <= max ? value : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** A short header derived from the question text, cut on whole characters. */
export function deriveHeader(question: string): string {
	const compact = sanitizeText(question, true);
	const chars = Array.from(compact);
	const header = chars.length <= MAX_HEADER_LENGTH ? compact : `${chars.slice(0, MAX_HEADER_LENGTH - 1).join("")}…`;
	return header.trim() || "Question";
}

/** `"true"` / `"false"` strings are a common model slip for booleans. */
function coerceBoolean(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const lowered = value.trim().toLowerCase();
	if (lowered === "true") return true;
	if (lowered === "false") return false;
	return value;
}

/** Structural repair of one question; values are left as authored. */
function repairQuestion(raw: unknown): unknown {
	const value = decodeObject(raw);
	if (!isRecord(value)) return value;
	const question: Record<string, unknown> = { ...value };
	if (question.options !== undefined) {
		const options = decodeArray(question.options);
		question.options = Array.isArray(options) ? options.map(decodeObject) : options;
	}
	if (question.multiSelect !== undefined) question.multiSelect = coerceBoolean(question.multiSelect);
	const header = question.header;
	if ((header === undefined || (typeof header === "string" && !header.trim())) && typeof question.question === "string") {
		question.header = deriveHeader(question.question);
	}
	return question;
}

/**
 * Pi's `prepareArguments` hook, run before schema validation. It only repairs
 * structure (flat single question, JSON-encoded strings, string booleans, a
 * missing header). It never drops, truncates, or rewrites authored values, so
 * every limit violation still reaches the model as a schema or validation error.
 */
export function prepareQuestionArguments(args: unknown): AskParams {
	if (!isRecord(args)) return args as AskParams;

	const top: Record<string, unknown> = { ...args };
	let questions: unknown = top.questions;
	if (typeof questions === "string") {
		const parsed = parseJson(questions);
		if (parsed !== undefined) {
			questions = parsed;
		} else if (top.question === undefined) {
			// A flat single question is occasionally sent as `questions: "..."`.
			top.question = questions;
			questions = undefined;
		}
	}
	if (isRecord(questions)) questions = [questions];
	if (questions === undefined && QUESTION_KEYS.some((key) => top[key] !== undefined)) questions = [{}];
	if (!Array.isArray(questions)) return { questions } as unknown as AskParams;

	const list = questions.map(decodeObject);
	if (list.length === 1 && isRecord(list[0])) {
		const only: Record<string, unknown> = { ...list[0] };
		for (const key of QUESTION_KEYS) {
			if (only[key] === undefined && top[key] !== undefined) only[key] = top[key];
		}
		list[0] = only;
	}

	return { questions: list.map(repairQuestion) } as unknown as AskParams;
}

function normalizeOption(option: AskOption, multiSelect: boolean): AskOption {
	const preview =
		!multiSelect && typeof option.preview === "string" && option.preview.trim()
			? truncateCodePoints(sanitizeText(option.preview), MAX_PREVIEW_CHARS)
			: undefined;
	return {
		label: sanitizeText(option.label, true),
		description: sanitizeText(option.description ?? "", true),
		...(preview ? { preview } : {}),
	};
}

function normalizeQuestion(question: AskQuestion): AskQuestion {
	const multiSelect = question.multiSelect === true;
	const text = sanitizeText(question.question);
	const header = sanitizeText(question.header ?? "", true);
	return {
		question: text,
		header: header || deriveHeader(text),
		options: (Array.isArray(question.options) ? question.options : []).map((option) =>
			normalizeOption(option, multiSelect),
		),
		...(multiSelect ? { multiSelect: true } : {}),
	};
}

/**
 * Sanitize schema-valid arguments for display (idempotent). Nothing is
 * dropped: text that sanitizes to empty is caught by `validateQuestionnaire`.
 * Previews are capped for rendering and stripped from multi-select questions,
 * which never show them.
 */
export function normalizeQuestionParams(params: AskParams): AskParams {
	const questions = Array.isArray(params.questions) ? params.questions : [];
	return { questions: questions.map(normalizeQuestion) };
}
