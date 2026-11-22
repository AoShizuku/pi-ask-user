import { Type, type Static } from "typebox";

import { MAX_HEADER_LENGTH, MAX_LABEL_LENGTH, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./types.js";

export const TOOL_NAME = "ask_user_question";

const OptionSchema = Type.Object(
	{
		label: Type.String({
			minLength: 1,
			maxLength: MAX_LABEL_LENGTH,
			description: `Short label (max ${MAX_LABEL_LENGTH} chars).`,
		}),
		description: Type.String({
			minLength: 1,
			description: "Impact or trade-off.",
		}),
		preview: Type.Optional(
			Type.String({
				description: "Optional markdown for single-select comparisons.",
			}),
		),
	},
	{ additionalProperties: false },
);

const QuestionSchema = Type.Object(
	{
		question: Type.String({
			minLength: 1,
			description: "The complete question.",
		}),
		header: Type.String({
			minLength: 1,
			maxLength: MAX_HEADER_LENGTH,
			description: `Short chip label (max ${MAX_HEADER_LENGTH} chars).`,
		}),
		options: Type.Array(OptionSchema, {
			minItems: MIN_OPTIONS,
			maxItems: MAX_OPTIONS,
			description: `${MIN_OPTIONS}-${MAX_OPTIONS} distinct choices; recommended first.`,
		}),
		multiSelect: Type.Optional(
			Type.Boolean({
				description: "Allow multiple choices.",
			}),
		),
	},
	{ additionalProperties: false },
);

export const QuestionParamsSchema = Type.Object(
	{
		questions: Type.Array(QuestionSchema, {
			minItems: 1,
			maxItems: MAX_QUESTIONS,
			description: `One to ${MAX_QUESTIONS} questions.`,
		}),
	},
	{ additionalProperties: false },
);

export type QuestionParams = Static<typeof QuestionParamsSchema>;
export type RawQuestion = Static<typeof QuestionSchema>;
export type RawOption = Static<typeof OptionSchema>;

export const TOOL_DESCRIPTION = "Ask the user one to four structured questions and wait for the answer.";

export const PROMPT_SNIPPET = "Ask the user structured questions when a decision is needed";

export const PROMPT_GUIDELINES = [
	"Use only when a decision blocks progress or materially changes the result; not for permission requests.",
	'Each question needs 2-4 options, recommended first with "(Recommended)". The UI appends free text; do not author "Other", "Type something.", or "Next".',
];

/** Labels the runtime appends or reserves. ASCII entries compare case-insensitively. */
export const RESERVED_LABELS = [
	"other",
	"other…",
	"other...",
	"type something",
	"type something.",
	"type something…",
	"next",
	"其他",
	"其他…",
	"自己输入",
	"下一题",
] as const;
