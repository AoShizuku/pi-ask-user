import type { AnswerDraft, AskQuestion, QuestionAnswer, QuestionnaireResult, SessionState } from "./types.js";
import { t } from "./i18n.js";

export type Choice = { kind: "option"; index: number } | { kind: "other" } | { kind: "next" };

export function createSessionState(questions: readonly AskQuestion[]): SessionState {
	return {
		questions,
		tab: 0,
		optionIndex: 0,
		reviewIndex: 0,
		answers: questions.map(() => ({ selected: [], custom: "", notes: "" })),
		globalNote: "",
		collapsed: false,
	};
}

export function isReviewTab(state: SessionState): boolean {
	return state.tab >= state.questions.length;
}

export function currentQuestion(state: SessionState): AskQuestion | undefined {
	return state.tab < state.questions.length ? state.questions[state.tab] : undefined;
}

export function choicesFor(question: AskQuestion): Choice[] {
	const choices: Choice[] = question.options.map((_option, index) => ({ kind: "option", index }));
	choices.push({ kind: "other" });
	if (question.multiSelect) choices.push({ kind: "next" });
	return choices;
}

export function selectedLabels(question: AskQuestion, draft: AnswerDraft): string[] {
	return draft.selected
		.map((index) => question.options[index]?.label)
		.filter((label): label is string => typeof label === "string");
}

export function isAnswered(state: SessionState, index: number): boolean {
	const draft = state.answers[index];
	if (!draft) return false;
	return draft.selected.length > 0 || draft.custom.trim().length > 0;
}

export function allAnswered(state: SessionState): boolean {
	return state.questions.every((_question, index) => isAnswered(state, index));
}

export function firstUnanswered(state: SessionState): number | undefined {
	const index = state.questions.findIndex((_question, questionIndex) => !isAnswered(state, questionIndex));
	return index >= 0 ? index : undefined;
}

export function nextUnanswered(state: SessionState, from: number): number | undefined {
	const count = state.questions.length;
	for (let step = 1; step <= count; step += 1) {
		const index = (from + step) % count;
		if (!isAnswered(state, index)) return index;
	}
	return undefined;
}

export function toggleMulti(state: SessionState, index: number): void {
	const draft = state.answers[state.tab];
	const question = currentQuestion(state);
	if (!draft || !question?.multiSelect) return;
	const at = draft.selected.indexOf(index);
	if (at >= 0) draft.selected.splice(at, 1);
	else draft.selected.push(index);
	draft.selected.sort((left, right) => left - right);
}

export function chooseSingle(state: SessionState, index: number): void {
	const draft = state.answers[state.tab];
	if (!draft) return;
	draft.selected = [index];
	draft.custom = "";
}

export function setCustom(state: SessionState, text: string): void {
	const draft = state.answers[state.tab];
	if (!draft) return;
	draft.custom = text.trim();
	if (draft.custom && currentQuestion(state)?.multiSelect !== true) draft.selected = [];
}

export function setNotes(state: SessionState, text: string): void {
	const draft = state.answers[state.tab];
	if (draft) draft.notes = text.trim();
}

/** Human-readable summary for the review tab. */
export function answerSummary(question: AskQuestion, draft: AnswerDraft): string {
	const labels = selectedLabels(question, draft);
	const custom = draft.custom.trim();
	const parts = [...labels];
	if (custom) parts.push(custom);
	return parts.length > 0 ? parts.join(", ") : t("answer.unanswered");
}

/**
 * Rebuild the drafts behind a submitted result, the inverse of `buildResult`,
 * so a transcript row can reopen the questionnaire as it was answered. Options
 * are matched by label (unique per question); a label that no longer matches
 * is kept as free text rather than dropped.
 */
export function restoreSessionState(questions: readonly AskQuestion[], result: QuestionnaireResult): SessionState {
	const state = createSessionState(questions);
	for (const answer of result.answers) {
		const question = questions[answer.questionIndex];
		const draft = state.answers[answer.questionIndex];
		if (!question || !draft) continue;
		const indexOf = (label: string) => question.options.findIndex((option) => option.label === label);
		if (answer.kind === "multi") {
			const indexes = (answer.selected ?? []).map(indexOf);
			draft.selected = indexes.filter((index) => index >= 0).sort((left, right) => left - right);
			const unmatched = (answer.selected ?? []).filter((_label, at) => indexes[at]! < 0);
			draft.custom = [...unmatched, ...(answer.answer ? [answer.answer] : [])].join(", ");
		} else if (answer.kind === "option") {
			const index = indexOf(answer.answer ?? "");
			if (index >= 0) draft.selected = [index];
			else draft.custom = answer.answer ?? "";
		} else {
			draft.custom = answer.answer ?? "";
		}
		draft.notes = answer.notes ?? "";
	}
	state.globalNote = result.globalNote ?? "";
	return state;
}

/** The option a question's cursor should rest on: its first selected option, else the free-text row when filled. */
export function answeredChoiceIndex(question: AskQuestion, draft: AnswerDraft): number {
	const first = draft.selected[0];
	if (first !== undefined) return first;
	return draft.custom.trim() ? question.options.length : 0;
}

/** Turn the current drafts into the structured result returned to the model. */
export function buildResult(state: SessionState, cancelled = false): QuestionnaireResult {
	const answers: QuestionAnswer[] = [];
	const unanswered: number[] = [];

	state.questions.forEach((question, index) => {
		const draft = state.answers[index] ?? { selected: [], custom: "", notes: "" };
		const labels = selectedLabels(question, draft);
		const custom = draft.custom.trim();
		const notes = draft.notes.trim();

		if (question.multiSelect) {
			if (labels.length === 0 && !custom) {
				unanswered.push(index);
				return;
			}
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "multi",
				answer: custom || null,
				selected: labels,
				...(notes ? { notes } : {}),
			});
			return;
		}

		if (custom) {
			answers.push({
				questionIndex: index,
				question: question.question,
				kind: "custom",
				answer: custom,
				...(notes ? { notes } : {}),
			});
			return;
		}

		const selectedIndex = draft.selected[0];
		if (selectedIndex === undefined) {
			unanswered.push(index);
			return;
		}
		const option = question.options[selectedIndex];
		if (!option) {
			unanswered.push(index);
			return;
		}
		answers.push({
			questionIndex: index,
			question: question.question,
			kind: "option",
			answer: option.label,
			...(option.preview ? { preview: option.preview } : {}),
			...(notes ? { notes } : {}),
		});
	});

	const result: QuestionnaireResult = {
		answers,
		cancelled,
		...(state.globalNote.trim() ? { globalNote: state.globalNote.trim() } : {}),
		...(unanswered.length > 0 ? { unanswered } : {}),
	};

	if (!cancelled && answers.length === 0 && !result.globalNote) {
		return { ...result, cancelled: true };
	}
	return result;
}
