type TuiModule = typeof import("./tui/questionnaire.js");
let tuiModule: Promise<TuiModule> | undefined;

/**
 * The TUI module pulls in pi's markdown/theme stack, so it loads lazily: once
 * warmed in the background when an interactive turn starts, and awaited on
 * first use otherwise. A failed load is retried on the next call.
 */
export function loadTui(): Promise<TuiModule> {
	tuiModule ??= import("./tui/questionnaire.js").catch((error: unknown) => {
		tuiModule = undefined;
		throw error;
	});
	return tuiModule;
}
