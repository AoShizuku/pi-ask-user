import {
	Editor,
	Input,
	Markdown,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type EditorTheme,
	type Focusable,
	type KeyId,
	type TUI,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme, getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";

import { collapseKey, keyLabel } from "../config.js";
import { t } from "../i18n.js";
import {
	allAnswered,
	answerSummary,
	answeredChoiceIndex,
	buildResult,
	choicesFor,
	chooseSingle,
	createSessionState,
	currentQuestion,
	isAnswered,
	isReviewTab,
	nextUnanswered,
	restoreSessionState,
	setCustom,
	setNotes,
	toggleMulti,
	type Choice,
} from "../session.js";
import type { AskQuestion, QuestionnaireResult, SessionState } from "../types.js";

export interface QuestionnaireOptions {
	/**
	 * Show this submitted result read-only instead of asking: no cursor, the answer in green; ←/→ switch
	 * questions, ↑/↓ step through the previews, and Esc (or Enter, q) closes. Nothing can be changed or confirmed.
	 */
	replay?: QuestionnaireResult;
}

type Mode = "browse" | "custom" | "notes" | "global-note" | "confirm-cancel" | "confirm-submit";
type EditorTarget = "custom" | "notes" | "global";

const MAX_PREVIEW_LINES = 14;

/**
 * Rows the cursor can land on start at the content column, where the question text starts, not in the
 * gutter: they hang under the question. The focused row carries the accent bar and the selection surface,
 * the same pair the other panels use (`pi-provider docs/ui.md` §0), moved over to that column.
 */
const ROW_INDENT = "  ";
const CURSOR_BAR = "▎";
/** The free-text row before anything is typed: a slot waiting to be filled. */
const EMPTY_TEXT_MARK = "◌";

/** Opens the full multi-line editor from the inline free-text row (pi's "external editor" key). */
const EXPAND_EDITOR_KEY: KeyId = "ctrl+g";

function flatten(text: string): string {
	return text.replace(/\s*\n\s*/g, " ");
}

function fit(text: string, width: number): string {
	return truncateToWidth(text, Math.max(1, width), "…");
}

/**
 * A titled rule, `─ left ───── right ─`, the full width (design_style.md §4.1): a bottom panel's top edge, and
 * the same shape for a divider inside a panel. Labels come in already colored; only the rule is painted here.
 * When the row is narrow the fill shrinks to one `─` first, then each right label is tried in turn (full form,
 * then shorter ones) and finally dropped, and last the left label is cut with `…`. The leading `─ ` and the
 * closing `─` always stay.
 */
export function titledRule(
	width: number,
	paint: (rule: string) => string,
	left: string,
	right: string | readonly string[] = [],
): string {
	const rule = (count: number) => paint("─".repeat(count));
	if (width < 4) return rule(Math.max(0, width));
	const leftWidth = visibleWidth(left);
	for (const label of typeof right === "string" ? [right] : right) {
		// `─ ` left ` ` fill ` ` right ` ─`
		const fill = width - leftWidth - visibleWidth(label) - 6;
		if (label && fill >= 1) return `${rule(1)} ${left} ${rule(fill)} ${label} ${rule(1)}`;
	}
	const shown = leftWidth <= width - 4 ? left : truncateToWidth(left, width - 4, "…");
	return `${rule(1)} ${shown} ${rule(width - 3 - visibleWidth(shown))}`;
}

/**
 * Put a row on the selection surface, padded so the surface reaches the right edge. Truncation leaves a full
 * reset inside the row, and that reset would drop the background for everything after it, so the background
 * is re-applied after each one.
 */
function onSurface(theme: Theme, content: string, width: number): string {
	const cut = fit(content, width);
	const padded = cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
	const band = theme.getBgAnsi("selectedBg");
	return theme.bg("selectedBg", padded.replace(/\x1b\[0m/g, `\x1b[0m${band}`));
}

function isEditorMode(mode: Mode): boolean {
	return mode === "custom" || mode === "notes" || mode === "global-note";
}

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text: string) => theme.fg("borderMuted", text),
		selectList: getSelectListTheme(),
	};
}

export class QuestionnaireComponent implements Component, Focusable {
	focused = false;

	private readonly state: SessionState;
	private readonly editor: Editor;
	/** Inline single-line field shown on the free-text row while it is focused. */
	private readonly input: Input;
	/**
	 * Uncommitted free text per question. Typing never changes the answer;
	 * only Enter commits. `undefined` means "same as the committed custom".
	 */
	private readonly pending: (string | undefined)[];
	/** Which question's text is loaded into `input`, if any. */
	private inputTab: number | undefined;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly settle: (result: ReturnType<typeof buildResult>) => void;
	private readonly removeAbort: (() => void) | undefined;
	/** Read-only replay of a submitted result. */
	private readonly replay: boolean;

	private mode: Mode = "browse";
	/** Where "keep answering" returns to; an open editor keeps its unsaved text. */
	private modeBeforeCancel: Mode = "browse";
	private editorTarget: EditorTarget = "custom";
	private confirmIndex = 1;
	private finished = false;
	private disposed = false;

	constructor(
		tui: TUI,
		theme: Theme,
		questions: readonly AskQuestion[],
		settle: (result: ReturnType<typeof buildResult>) => void,
		signal?: AbortSignal,
		options: QuestionnaireOptions = {},
	) {
		this.tui = tui;
		this.theme = theme;
		this.replay = options.replay !== undefined;
		this.state = options.replay ? restoreSessionState(questions, options.replay) : createSessionState(questions);
		if (this.replay) this.restCursor();
		this.settle = settle;
		this.editor = new Editor(tui, editorTheme(theme), { paddingX: 0 });
		this.editor.onSubmit = (text) => this.commitEditor(text);
		this.editor.focused = false;
		this.input = new Input({
			prompt: "",
			placeholder: t("sentinel.typeSomething"),
			placeholderStyle: (text: string) => theme.fg("dim", text),
		});
		this.input.focused = false;
		this.pending = questions.map(() => undefined);

		if (signal) {
			const onAbort = () => this.finish(true);
			signal.addEventListener("abort", onAbort, { once: true });
			this.removeAbort = () => signal.removeEventListener("abort", onAbort);
			if (signal.aborted) queueMicrotask(() => this.finish(true));
		}
	}

	dispose(): void {
		this.disposed = true;
		this.editor.focused = false;
		this.input.focused = false;
		this.removeAbort?.();
	}

	invalidate(): void {
		this.editor.invalidate();
		this.input.invalidate();
	}

	/** True while the focused row is the free-text row and keys go to the inline field. */
	private inlineActive(): boolean {
		if (this.replay || this.mode !== "browse" || this.state.collapsed || isReviewTab(this.state)) return false;
		return this.choices()[this.state.optionIndex]?.kind === "other";
	}

	/** Text shown for a question's free-text row: pending edits first, else the committed answer. */
	private freeText(tab: number): string {
		return this.pending[tab] ?? this.state.answers[tab]?.custom ?? "";
	}

	/** Load the current question's text into the inline field when the row gains focus. */
	private syncInput(): void {
		const active = this.inlineActive();
		this.input.focused = active;
		if (!active) {
			this.inputTab = undefined;
			return;
		}
		if (this.inputTab === this.state.tab) return;
		this.inputTab = this.state.tab;
		const text = flatten(this.freeText(this.state.tab));
		this.input.setValue(text);
		// setValue keeps the old cursor column; send the field's own line-end key (ctrl+e).
		this.input.handleInput("\x05");
	}

	/**
	 * Commit free text as the answer. Single-select: non-empty text replaces the
	 * chosen option and advances; empty text clears the custom answer. Multi-select:
	 * the text joins the checked options and focus stays.
	 */
	private commitCustom(text: string): void {
		const question = this.current();
		if (!question) return;
		setCustom(this.state, text);
		this.pending[this.state.tab] = undefined;
		this.inputTab = undefined;
		this.mode = "browse";
		this.editor.focused = false;
		if (!question.multiSelect && text.trim()) {
			this.advanceAfterAnswer();
			return;
		}
		this.requestRender();
	}

	private handleInlineInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.requestCancel();
			return;
		}
		if (matchesKey(data, "up")) return this.move(-1);
		if (matchesKey(data, "down")) return this.move(1);
		if (matchesKey(data, "tab")) return this.switchTab(1);
		if (matchesKey(data, "shift+tab")) return this.switchTab(-1);
		if (matchesKey(data, "enter")) {
			this.commitCustom(this.freeText(this.state.tab));
			return;
		}
		if (matchesKey(data, EXPAND_EDITOR_KEY)) {
			this.openEditor("custom");
			return;
		}
		// Everything else, including ←/→, letters, digits, and Space, edits the text.
		const before = this.input.getValue();
		this.input.handleInput(data);
		const after = this.input.getValue();
		if (after !== before) this.pending[this.state.tab] = after;
		this.requestRender();
	}

	private requestRender(): void {
		if (!this.disposed) this.tui.requestRender();
	}

	private finish(cancelled: boolean): void {
		if (this.finished) return;
		this.finished = true;
		this.editor.focused = false;
		this.removeAbort?.();
		this.settle(buildResult(this.state, cancelled));
	}

	private current(): AskQuestion | undefined {
		return currentQuestion(this.state);
	}

	private currentDraft() {
		return this.state.answers[this.state.tab];
	}

	private choices(): Choice[] {
		const question = this.current();
		if (!question) return [];
		const choices = choicesFor(question);
		// Next only moves a live questionnaire along; a replay has nowhere to go.
		return this.replay ? choices.filter((choice) => choice.kind !== "next") : choices;
	}

	/** Replay: rest on what was answered, so its preview shows first. */
	private restCursor(): void {
		const question = this.current();
		const draft = this.currentDraft();
		this.state.optionIndex = question && draft ? answeredChoiceIndex(question, draft) : 0;
	}

	/** Indexes of the current question's choices that have a preview; only single-select questions have any. */
	private previewChoices(): number[] {
		const question = this.current();
		if (!question || question.multiSelect) return [];
		return this.choices().flatMap((choice, index) =>
			choice.kind === "option" && question.options[choice.index]?.preview ? [index] : [],
		);
	}

	/**
	 * Replay ↑/↓: step through the previews. There is no cursor to move (nothing can be chosen, and green
	 * already shows the answer), so the keys only switch which preview shows; its divider names the option.
	 */
	private stepPreview(delta: number): void {
		const stops = this.previewChoices();
		if (stops.length === 0) return;
		const at = stops.indexOf(this.state.optionIndex);
		const next = at < 0 ? (delta > 0 ? 0 : stops.length - 1) : (at + delta + stops.length) % stops.length;
		this.state.optionIndex = stops[next]!;
		this.requestRender();
	}

	/** Replay keys: look around, never change anything; every way out just closes. */
	private handleReplayInput(data: string): void {
		const count = this.state.questions.length;
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "enter") || data.toLowerCase() === "q") {
			this.finish(true);
			return;
		}
		const step =
			matchesKey(data, "left") || matchesKey(data, "shift+tab") ? -1 : matchesKey(data, "right") || matchesKey(data, "tab") ? 1 : 0;
		if (step !== 0) {
			if (count <= 1) return;
			this.state.tab = (this.state.tab + step + count) % count;
			this.restCursor();
			this.requestRender();
			return;
		}
		if (matchesKey(data, "up")) this.stepPreview(-1);
		else if (matchesKey(data, "down")) this.stepPreview(1);
	}

	private reviewRows(): number {
		return this.state.questions.length + 1;
	}

	private move(delta: number): void {
		if (isReviewTab(this.state)) {
			const count = this.reviewRows();
			this.state.reviewIndex = (this.state.reviewIndex + delta + count) % count;
		} else {
			const count = this.choices().length;
			if (count > 0) this.state.optionIndex = (this.state.optionIndex + delta + count) % count;
		}
		this.requestRender();
	}

	private switchTab(delta: number): void {
		const total = this.state.questions.length + (this.state.questions.length > 1 ? 1 : 0);
		if (total <= 1) return;
		this.state.tab = (this.state.tab + delta + total) % total;
		this.state.optionIndex = 0;
		this.state.reviewIndex = 0;
		this.mode = "browse";
		this.editor.focused = false;
		this.requestRender();
	}

	private jumpToQuestion(index: number): void {
		this.state.tab = index;
		this.state.optionIndex = 0;
		this.mode = "browse";
		this.editor.focused = false;
		this.requestRender();
	}

	private advanceAfterAnswer(): void {
		if (this.state.questions.length === 1) {
			this.finish(false);
			return;
		}
		if (allAnswered(this.state)) {
			this.state.tab = this.state.questions.length;
			this.state.reviewIndex = 0;
			this.requestRender();
			return;
		}
		const next = nextUnanswered(this.state, this.state.tab);
		if (next !== undefined) {
			this.state.tab = next;
			this.state.optionIndex = 0;
		}
		this.requestRender();
	}

	private activate(): void {
		if (isReviewTab(this.state)) {
			if (this.state.reviewIndex < this.state.questions.length) {
				this.jumpToQuestion(this.state.reviewIndex);
			} else {
				this.requestSubmit();
			}
			return;
		}

		const question = this.current();
		const draft = this.currentDraft();
		const choice = this.choices()[this.state.optionIndex];
		if (!question || !draft || !choice) return;

		if (choice.kind === "option") {
			if (question.multiSelect) {
				toggleMulti(this.state, choice.index);
				this.requestRender();
				return;
			}
			chooseSingle(this.state, choice.index);
			this.advanceAfterAnswer();
			return;
		}
		if (choice.kind === "other") {
			// Focusing the row is enough: the inline field takes the next keys.
			this.requestRender();
			return;
		}
		// With one question there is no review tab: an empty Next would submit a
		// silent decline. Declining goes through Esc and its confirmation instead.
		if (this.state.questions.length === 1 && !isAnswered(this.state, this.state.tab)) return;
		this.advanceAfterAnswer();
	}

	private chooseDigit(digit: number): void {
		const index = digit - 1;
		if (isReviewTab(this.state)) {
			if (index < this.reviewRows()) {
				this.state.reviewIndex = index;
				this.activate();
			}
			return;
		}
		if (index < this.choices().length) {
			this.state.optionIndex = index;
			this.activate();
		}
	}

	private openEditor(target: EditorTarget): void {
		if (target !== "global" && isReviewTab(this.state)) return;
		this.editorTarget = target;
		this.mode = target === "custom" ? "custom" : target === "global" ? "global-note" : "notes";
		const value =
			target === "custom"
				? this.freeText(this.state.tab)
				: target === "global"
					? this.state.globalNote
					: (this.currentDraft()?.notes ?? "");
		this.editor.setText(value);
		this.editor.focused = true;
		this.input.focused = false;
		this.requestRender();
	}

	private commitEditor(text: string): void {
		if (this.editorTarget === "custom") {
			this.commitCustom(text);
			return;
		}
		if (this.editorTarget === "notes") setNotes(this.state, text);
		else this.state.globalNote = text.trim();
		this.closeEditor();
	}

	/**
	 * Leave the editor without saving. For free text the inline row's pending
	 * text is untouched, so Esc from the full editor returns to the row as it was.
	 */
	private closeEditor(): void {
		this.mode = "browse";
		this.editor.focused = false;
		this.inputTab = undefined;
		this.requestRender();
	}

	private requestCancel(): void {
		this.modeBeforeCancel = this.mode === "confirm-cancel" || this.mode === "confirm-submit" ? "browse" : this.mode;
		this.mode = "confirm-cancel";
		this.confirmIndex = 1;
		this.editor.focused = false;
		this.input.focused = false;
		this.requestRender();
	}

	private leaveConfirm(): void {
		this.mode = this.mode === "confirm-cancel" ? this.modeBeforeCancel : "browse";
		this.editor.focused = isEditorMode(this.mode);
		this.requestRender();
	}

	private requestSubmit(): void {
		const unanswered = this.state.questions.length - this.state.answers.filter((_draft, index) => isAnswered(this.state, index)).length;
		if (unanswered > 0) {
			this.mode = "confirm-submit";
			this.confirmIndex = 1;
			this.requestRender();
			return;
		}
		this.finish(false);
	}

	handleInput(data: string): void {
		if (this.replay) {
			this.handleReplayInput(data);
			return;
		}
		if (matchesKey(data, collapseKey() as KeyId)) {
			this.state.collapsed = !this.state.collapsed;
			this.editor.focused = !this.state.collapsed && isEditorMode(this.mode);
			this.requestRender();
			return;
		}

		if (this.state.collapsed) {
			if (matchesKey(data, "escape")) {
				// Expand and confirm, as Esc does when expanded; never cancel blind.
				this.state.collapsed = false;
				this.requestCancel();
			} else if (matchesKey(data, "enter")) {
				this.state.collapsed = false;
				this.editor.focused = isEditorMode(this.mode);
				this.requestRender();
			}
			return;
		}

		if (isEditorMode(this.mode)) {
			if (matchesKey(data, "escape")) {
				this.closeEditor();
				return;
			}
			this.editor.handleInput(data);
			return;
		}

		if (this.mode === "confirm-cancel" || this.mode === "confirm-submit") {
			if (matchesKey(data, "up") || matchesKey(data, "down")) {
				this.confirmIndex = this.confirmIndex === 0 ? 1 : 0;
				this.requestRender();
			} else if (matchesKey(data, "enter")) {
				if (this.confirmIndex === 0) this.finish(this.mode === "confirm-cancel");
				else this.leaveConfirm();
			} else if (matchesKey(data, "escape")) {
				this.leaveConfirm();
			}
			return;
		}

		this.syncInput();
		if (this.inlineActive()) {
			this.handleInlineInput(data);
			return;
		}

		if (matchesKey(data, "escape")) {
			this.requestCancel();
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.requestCancel();
			return;
		}
		if (matchesKey(data, "tab")) {
			this.switchTab(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.switchTab(-1);
			return;
		}
		if (matchesKey(data, "left")) {
			this.switchTab(-1);
			return;
		}
		if (matchesKey(data, "right")) {
			this.switchTab(1);
			return;
		}
		if (matchesKey(data, "up")) {
			this.move(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.move(1);
			return;
		}
		if (matchesKey(data, "enter")) {
			this.activate();
			return;
		}
		if (matchesKey(data, "space")) {
			// Space only toggles checkboxes; on single-select it must not submit.
			const choice = isReviewTab(this.state) ? undefined : this.choices()[this.state.optionIndex];
			if (this.current()?.multiSelect && choice?.kind === "option") {
				toggleMulti(this.state, choice.index);
				this.requestRender();
			}
			return;
		}
		if (/^[1-9]$/u.test(data)) {
			this.chooseDigit(Number(data));
			return;
		}
		if (data.toLocaleLowerCase() === "n") {
			if (isReviewTab(this.state)) this.openEditor("global");
			else this.openEditor("notes");
			return;
		}
		if (data.toLocaleLowerCase() === "o") {
			// Jump to the free-text row; typing then goes straight into it.
			const index = this.choices().findIndex((choice) => choice.kind === "other");
			if (index >= 0) {
				this.state.optionIndex = index;
				this.requestRender();
			}
		}
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		this.syncInput();
		// pi-tui aborts the whole TUI on any line wider than the terminal, so
		// every line is clamped here regardless of how it was built.
		return this.renderLines(safeWidth).map((line) => (visibleWidth(line) > safeWidth ? fit(line, safeWidth) : line));
	}

	private renderLines(safeWidth: number): string[] {
		if (this.state.collapsed) {
			// Collapsed, the top edge is the whole panel, so it carries the expand key where the stats would go.
			const hint = t("hint.collapsed", { key: keyLabel(collapseKey()) });
			return [this.edge(safeWidth, this.title(), [`${this.progress()} · ${hint}`, hint])];
		}

		const lines: string[] = [];
		if (this.mode === "confirm-cancel" || this.mode === "confirm-submit") {
			this.renderConfirm(lines, safeWidth);
			return lines;
		}

		lines.push(this.edge(safeWidth, this.title(), this.progress()));
		if (this.state.questions.length > 1) lines.push(this.renderTabs(safeWidth));
		if (this.replay && this.state.globalNote) {
			const note = `${t("review.globalNote")}: ${this.state.globalNote.replace(/\s+/g, " ")}`;
			lines.push(this.theme.fg("muted", fit(note, safeWidth)));
		}
		lines.push("");

		if (isEditorMode(this.mode)) {
			this.renderEditor(lines, safeWidth);
		} else if (isReviewTab(this.state)) {
			this.renderReview(lines, safeWidth);
		} else {
			this.renderQuestion(lines, safeWidth);
		}

		lines.push("");
		lines.push(this.renderHint(safeWidth));
		return lines;
	}

	/**
	 * The panel's top edge (design_style.md §4.1): it carries on the editor's top border, with the title on the
	 * left and the state on the right. Every mode draws it, so the panel keeps its edge through confirm and collapse.
	 */
	private edge(width: number, left: string, right: string | readonly string[] = []): string {
		const dim = (text: string) => (text ? this.theme.fg("dim", text) : text);
		const labels = (typeof right === "string" ? [right] : right).map(dim);
		return titledRule(width, (rule) => this.theme.fg("borderMuted", rule), left, labels);
	}

	private title(): string {
		return this.theme.bold(this.theme.fg("accent", this.replay ? t("replay.title") : t("ask.title")));
	}

	/** Where the questionnaire stands: the question shown, or on the review tab how many are answered. */
	private progress(): string {
		const total = this.state.questions.length;
		const current = Math.min(this.state.tab + 1, total);
		const meta = isReviewTab(this.state)
			? `${this.state.answers.filter((_draft, index) => isAnswered(this.state, index)).length}/${total} ${t("ask.answered")}`
			: t("ask.progress", { current, total });
		return this.replay ? `${meta} · ${t("replay.readonly")}` : meta;
	}

	private renderTabs(width: number): string {
		const parts: string[] = [];
		for (let index = 0; index < this.state.questions.length; index += 1) {
			const question = this.state.questions[index]!;
			const answered = isAnswered(this.state, index);
			const current = index === this.state.tab;
			// A replay keeps ✓/○ on the current tab too: which questions were answered is what it shows.
			const marker = current && !this.replay ? "●" : answered ? "✓" : "○";
			const text = `${marker} ${index + 1}. ${question.header}`;
			const color = current ? "accent" : this.replay && answered ? "success" : "dim";
			parts.push(this.theme.fg(color, current && this.replay ? this.theme.bold(text) : text));
		}
		if (!this.replay) {
			const review = `${isReviewTab(this.state) ? "●" : "○"} ${t("ask.reviewTab")}`;
			parts.push(isReviewTab(this.state) ? this.theme.fg("accent", review) : this.theme.fg("dim", review));
		}
		const line = parts.join("  ");
		if (visibleWidth(line) <= width) return line;
		if (this.replay) return fit(this.theme.fg("muted", `${this.state.tab + 1}/${this.state.questions.length}`), width);
		return fit(
			this.theme.fg("muted", `${this.state.tab + 1}/${this.state.questions.length + 1} · ${t("ask.reviewTab")}`),
			width,
		);
	}

	private renderQuestion(lines: string[], width: number): void {
		const question = this.current();
		const draft = this.currentDraft();
		if (!question || !draft) {
			lines.push(this.theme.fg("muted", t("ask.noQuestions")));
			return;
		}

		const questionWidth = Math.max(1, width - 2);
		for (const line of wrapTextWithAnsi(question.question, questionWidth)) {
			lines.push(`  ${this.theme.bold(this.theme.fg("text", line))}`);
		}
		if (draft.notes) {
			const note = `${t("answer.note")}: ${draft.notes.replace(/\s+/g, " ")}`;
			lines.push(`  ${this.theme.fg("dim", fit(note, width - 2))}`);
		}
		lines.push("");

		const choices = this.choices();
		choices.forEach((choice, index) => {
			lines.push(...this.renderChoice(question, draft, choice, index, width));
		});

		const focused = choices[this.state.optionIndex];
		if (focused?.kind === "option" && !question.multiSelect) {
			const option = question.options[focused.index];
			if (option?.preview) this.renderPreview(lines, option.preview, `${focused.index + 1}. ${option.label}`, width);
		}
	}

	/**
	 * Lay out one cursor stop from the content column. Focused, every line of it gets the accent bar and the
	 * selection surface, so a wrapped label and its description read as one block; otherwise two blank columns
	 * keep the text where the bar would be.
	 */
	private cursorRow(lines: readonly string[], focused: boolean, width: number): string[] {
		if (!focused) return lines.map((line) => `${ROW_INDENT}  ${line}`);
		const bar = this.theme.fg("accent", CURSOR_BAR);
		const surfaceWidth = Math.max(1, width - ROW_INDENT.length);
		return lines.map((line) => `${ROW_INDENT}${onSurface(this.theme, `${bar} ${line}`, surfaceWidth)}`);
	}

	private renderChoice(
		question: AskQuestion,
		draft: { selected: number[]; custom: string; notes: string },
		choice: Choice,
		index: number,
		width: number,
	): string[] {
		// A replay has no cursor: nothing can be chosen there, and green already shows the answer.
		const focused = !this.replay && index === this.state.optionIndex;
		let marker = "○";
		let label: string;
		/** What the answer holds is green, focused or not; the bar and the surface alone show focus. */
		let selected = false;
		if (choice.kind === "option") {
			const option = question.options[choice.index]!;
			selected = draft.selected.includes(choice.index);
			if (question.multiSelect) marker = selected ? "☑" : "☐";
			else marker = selected ? "◉" : "○";
			label = `${choice.index + 1}. ${option.label}`;
		} else if (choice.kind === "other") {
			selected = draft.custom.length > 0;
			marker = draft.custom ? "◉" : EMPTY_TEXT_MARK;
			if (focused && this.inlineActive()) {
				// Live single-line field; the TUI places the hardware cursor (and IME) in it.
				const prefix = `${marker} `;
				const fieldWidth = Math.max(1, width - ROW_INDENT.length - 2 - visibleWidth(prefix));
				const field = this.input.render(fieldWidth)[0] ?? "";
				const paintedPrefix = selected ? this.theme.fg("success", prefix) : prefix;
				return this.cursorRow([`${paintedPrefix}${field}`], true, width);
			}
			const text = flatten(this.freeText(this.state.tab));
			const pending = this.pending[this.state.tab];
			// Edited but not committed with Enter: the answer is still the old one.
			const unsaved = pending !== undefined && pending.trim() !== draft.custom;
			label = `${t("sentinel.typeSomething")}${text ? ` — ${text}` : ""}`;
			if (unsaved) label += ` ${this.theme.fg("warning", `(${t("custom.unsaved")})`)}`;
		} else {
			marker = "✔";
			label = `${t("sentinel.next")} →`;
		}

		const prefix = `${marker} `;
		const hang = " ".repeat(visibleWidth(prefix));
		const textWidth = Math.max(1, width - ROW_INDENT.length - 2 - visibleWidth(prefix));
		const paint = (text: string) => (selected ? this.theme.fg("success", text) : text);
		const wrapped = wrapTextWithAnsi(label, textWidth);
		const body = [paint(`${prefix}${wrapped[0] ?? ""}`), ...wrapped.slice(1).map((line) => `${hang}${paint(line)}`)];

		if (choice.kind === "option") {
			const description = question.options[choice.index]?.description;
			if (description) {
				// Aligned with the label text, under the marker's hang.
				for (const line of wrapTextWithAnsi(description, textWidth).slice(0, 2)) {
					body.push(`${hang}${this.theme.fg("muted", line)}`);
				}
			}
		}
		return this.cursorRow(body, focused, width);
	}

	/** The preview of one option; the divider names it, since a replay shows no cursor to point at it. */
	private renderPreview(lines: string[], preview: string, option: string, width: number): void {
		lines.push("");
		// A divider inside the panel: the top edge's shape, its label muted rather than accent.
		lines.push(titledRule(width, (rule) => this.theme.fg("borderMuted", rule), this.theme.fg("muted", `${t("hint.preview")} · ${option}`)));
		const markdown = new Markdown(preview, 0, 0, getMarkdownTheme());
		const rendered = markdown.render(Math.max(1, width - 2));
		for (const line of rendered.slice(0, MAX_PREVIEW_LINES)) lines.push(` ${line}`);
		if (rendered.length > MAX_PREVIEW_LINES) lines.push(this.theme.fg("dim", " …"));
	}

	private renderEditor(lines: string[], width: number): void {
		const question = this.current();
		if (question) {
			for (const line of wrapTextWithAnsi(question.question, Math.max(1, width - 2))) {
				lines.push(`  ${this.theme.bold(this.theme.fg("text", line))}`);
			}
			lines.push("");
		}
		const title =
			this.editorTarget === "custom"
				? t("custom.title")
				: this.editorTarget === "global"
					? t("notes.globalTitle")
					: t("notes.title");
		lines.push(this.theme.fg("accent", `  ${title}`));
		lines.push("");
		for (const line of this.editor.render(width)) lines.push(line);
	}

	private renderReview(lines: string[], width: number): void {
		// The heading stands where a question's text would.
		lines.push(`${ROW_INDENT}${this.theme.bold(this.theme.fg("text", t("review.heading")))}`);
		lines.push("");
		for (let index = 0; index < this.state.questions.length; index += 1) {
			const question = this.state.questions[index]!;
			const draft = this.state.answers[index]!;
			const focused = index === this.state.reviewIndex;
			const summary = answerSummary(question, draft);
			const unanswered = !isAnswered(this.state, index);
			const marker = unanswered ? "○" : "✓";
			const note = draft.notes ? `  ${this.theme.fg("dim", `(${t("answer.note")})`)}` : "";
			lines.push(...this.cursorRow([`${marker} ${index + 1}. ${question.header} → ${summary}${note}`], focused, width));
		}

		const submitFocused = this.state.reviewIndex === this.state.questions.length;
		const unanswered = this.state.questions.length - this.state.answers.filter((_draft, index) => isAnswered(this.state, index)).length;
		const submitLabel = unanswered > 0 ? t("review.submitUnanswered", { count: unanswered }) : t("review.submit");
		lines.push("");
		lines.push(...this.cursorRow([`✔ ${submitLabel}`], submitFocused, width));

		// Under the rows' text, past the bar column.
		const textIndent = `${ROW_INDENT}  `;
		if (this.state.globalNote) {
			lines.push("");
			const note = `${t("review.globalNote")}: ${this.state.globalNote.replace(/\s+/g, " ")}`;
			lines.push(`${textIndent}${this.theme.fg("muted", fit(note, width - textIndent.length))}`);
		}
		lines.push("");
		lines.push(`${textIndent}${this.theme.fg("dim", t("review.jumpHint"))}`);
	}

	private renderConfirm(lines: string[], width: number): void {
		const cancel = this.mode === "confirm-cancel";
		const title = cancel ? t("confirm.cancelTitle") : t("confirm.submitTitle");
		const body = cancel ? t("confirm.cancelBody") : t("confirm.submitBody");
		const yes = cancel ? t("confirm.cancelYes") : t("confirm.submitYes");
		const no = cancel ? t("confirm.cancelNo") : t("confirm.submitNo");
		lines.push(this.edge(width, this.theme.bold(this.theme.fg("warning", title))));
		lines.push("");
		for (const line of wrapTextWithAnsi(body, Math.max(1, width - 2))) lines.push(`  ${this.theme.fg("muted", line)}`);
		lines.push("");
		lines.push(...this.cursorRow([yes], this.confirmIndex === 0, width));
		lines.push(...this.cursorRow([no], this.confirmIndex === 1, width));
		lines.push("");
		lines.push(fit(this.theme.fg("dim", t("hint.confirm")), width));
	}

	/** Replay keys: ←→ only with several questions, ↑↓ only where there are previews to step through. */
	private replayHint(): string {
		const parts: string[] = [];
		if (this.state.questions.length > 1) parts.push(t("hint.replaySwitch"));
		if (this.previewChoices().length > 0) parts.push(t("hint.replayPreview"));
		parts.push(t("hint.replayClose"));
		return parts.join(" · ");
	}

	private renderHint(width: number): string {
		const key = keyLabel(collapseKey());
		let hint: string;
		if (this.replay) hint = this.replayHint();
		else if (isEditorMode(this.mode)) hint = t("hint.editor");
		else if (this.inlineActive()) hint = t("hint.inline", { key });
		else if (isReviewTab(this.state)) hint = t("hint.review");
		else hint = this.current()?.multiSelect ? t("hint.multi", { key }) : t("hint.browse", { key });
		return fit(this.theme.fg("dim", hint), width);
	}
}

export function emptyComponent(): Component {
	return {
		render: () => [],
		invalidate: () => undefined,
	};
}
