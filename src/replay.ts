// Reopening an answered questionnaire from its transcript row, read-only.
//
// A click on the row has no extension context, so the plugin hands over the UI
// whenever it sees an interactive TUI context. The replay takes the editor's
// place like the live questionnaire; pi restores the editor text when it closes.

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { normalizeQuestionParams } from "./normalize.js";
import { loadTui } from "./tui-loader.js";
import type { AskParams, QuestionnaireResult } from "./types.js";

let host: ExtensionUIContext | undefined;
/** Closes the replay on screen, if any. */
let closeActive: (() => void) | undefined;
/** Bumped by every open and close, so a replay still loading after a close never shows. */
let generation = 0;

/** The UI replays open in; undefined outside an interactive TUI. */
export function setReplayHost(ui: ExtensionUIContext | undefined): void {
	host = ui;
	if (!ui) closeReplay();
}

export function canReplay(): boolean {
	return host !== undefined;
}

/**
 * Close the replay on screen. A live questionnaire calls this first: pi stacks
 * inline dialogs, so a replay left open would reappear once the answer is in.
 */
export function closeReplay(): void {
	generation += 1;
	const close = closeActive;
	closeActive = undefined;
	close?.();
}

/** Open a read-only replay of `args` as answered in `result`. Returns whether one was opened. */
export function openReplay(args: AskParams | undefined, result: QuestionnaireResult): boolean {
	const ui = host;
	if (!ui || !Array.isArray(args?.questions) || args.questions.length === 0) return false;
	// Rendered args are what the model sent; strip control sequences the same way execution did.
	const { questions } = normalizeQuestionParams(args);
	closeReplay();
	const ticket = generation;
	let close: (() => void) | undefined;
	void loadTui()
		.then(({ QuestionnaireComponent }) => {
			if (ticket !== generation) return undefined;
			return ui.custom<undefined>((tui, theme, _keybindings, done) => {
				close = () => done(undefined);
				closeActive = close;
				return new QuestionnaireComponent(tui, theme, questions, () => done(undefined), undefined, { replay: result });
			});
		})
		.catch(() => undefined)
		.finally(() => {
			if (closeActive === close) closeActive = undefined;
		});
	return true;
}
