import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getSelectListTheme: () => ({
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	}),
	getMarkdownTheme: () => ({
		heading: (text: string) => text,
		link: (text: string) => text,
		linkUrl: (text: string) => text,
		code: (text: string) => text,
		codeBlock: (text: string) => text,
		codeBlockBorder: (text: string) => text,
		quote: (text: string) => text,
		quoteBorder: (text: string) => text,
		hr: (text: string) => text,
		listBullet: (text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		strikethrough: (text: string) => text,
		underline: (text: string) => text,
	}),
}));

import { QuestionnaireComponent } from "./questionnaire.js";
import type { AskQuestion, QuestionnaireResult } from "../types.js";

/** A real (zero-width) background escape, so width checks still hold and tests can find the surface. */
const SURFACE = "\x1b[48;5;236m";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `${SURFACE}${text}\x1b[49m`,
	getBgAnsi: () => SURFACE,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
} as unknown as Theme;

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

const tui = { requestRender: vi.fn(), terminal: { rows: 24 } } as unknown as TUI;

const questions: AskQuestion[] = [
	{
		question: "Which database?",
		header: "DB",
		options: [
			{ label: "Postgres", description: "Reliable SQL." },
			{ label: "SQLite", description: "Simple local file." },
		],
	},
	{
		question: "Which features?",
		header: "Features",
		multiSelect: true,
		options: [
			{ label: "Auth", description: "Login." },
			{ label: "Cache", description: "Faster reads." },
			{ label: "Search", description: "Full text." },
		],
	},
];

function type(component: QuestionnaireComponent, text: string): void {
	for (const ch of text) component.handleInput(ch);
}

function create() {
	let settled: QuestionnaireResult | undefined;
	const component = new QuestionnaireComponent(tui, theme, questions, (result) => {
		settled = result;
	});
	return { component, settled: () => settled };
}

describe("QuestionnaireComponent", () => {
	it("renders the question, options, and free-text row", () => {
		const { component } = create();
		const text = component.render(80).join("\n");
		expect(text).toContain("Which database?");
		expect(text).toContain("Postgres");
		expect(text).toContain("SQLite");
		expect(text).toContain("Type something.");
		expect(text).toContain("1/2");
	});

	it("keeps the titled top edge through browse, confirm and collapse", () => {
		const { component } = create();
		const top = () => plain(component.render(40)[0]!);
		expect(top()).toMatch(/^─ Ask ─+ Question 1\/2 ─$/);
		component.handleInput("\u001d"); // collapse: the edge is the whole panel
		expect(component.render(40)).toHaveLength(1);
		expect(top()).toMatch(/^─ Ask ─+ .*Ctrl\+\] expand ─$/);
		component.handleInput("\u001b"); // Esc while collapsed asks first
		expect(top()).toMatch(/^─ Cancel this questionnaire\? ─+$/);
		for (const line of component.render(40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	it("marks the focused option with a bar and the surface, label and description alike", () => {
		const { component } = create();
		const lines = component.render(40);
		const label = lines.find((line) => line.includes("1. Postgres"))!;
		const description = lines.find((line) => line.includes("Reliable SQL."))!;
		// The bar sits at the content column, under the question text, not in the gutter.
		expect(plain(label).trimEnd()).toBe("  ▎ ○ 1. Postgres");
		expect(plain(description).trimEnd()).toBe("  ▎   Reliable SQL.");
		for (const line of [label, description]) {
			expect(line.startsWith(`  ${SURFACE}`)).toBe(true);
			// The surface runs to the right edge.
			expect(visibleWidth(line)).toBe(40);
		}
		// Unfocused rows: no bar, no surface, the description under the label text.
		const other = lines.find((line) => line.includes("2. SQLite"))!;
		expect(other).toBe("    ○ 2. SQLite");
		expect(lines.find((line) => line.includes("Simple local file."))).toBe("      Simple local file.");
	});

	it("shows an empty free-text row as a slot to fill", () => {
		const { component } = create();
		expect(component.render(80)).toContain("    ◌ Type something.");
	});

	it("moves the bar to the review rows and the confirmation choices", () => {
		const { component } = create();
		component.handleInput("\r");
		component.handleInput("\t");
		const review = component.render(80);
		expect(plain(review.find((line) => line.includes("DB →"))!).startsWith("  ▎ ✓ 1. DB → Postgres")).toBe(true);
		expect(review).toContain("    ✔ Submit with 1 unanswered");
		component.handleInput("\u001b");
		const confirm = component.render(80);
		expect(plain(confirm.find((line) => line.includes("Keep answering"))!).startsWith("  ▎ Keep answering")).toBe(true);
		expect(confirm).toContain("    Cancel questionnaire");
	});

	it("advances after a single-select choice", () => {
		const { component } = create();
		component.handleInput("\r");
		const text = component.render(80).join("\n");
		expect(text).toContain("Which features?");
	});

	it("opens notes and returns on escape", () => {
		const { component } = create();
		component.handleInput("n");
		expect(component.render(80).join("\n")).toContain("Note for this answer");
		component.handleInput("\u001b");
		expect(component.render(80).join("\n")).not.toContain("Note for this answer");
	});

	it("shows the review tab and submits with unanswered questions", () => {
		const { component, settled } = create();
		component.handleInput("\r"); // answer question 1, advance to question 2
		component.handleInput("\t"); // move to the review tab
		expect(component.render(80).join("\n")).toContain("Review your answers");
		// Move to the submit row (question rows come first).
		component.handleInput("\u001b[B");
		component.handleInput("\u001b[B");
		component.handleInput("\r");
		expect(component.render(80).join("\n")).toContain("Some questions are unanswered");
		component.handleInput("\u001b[A");
		component.handleInput("\r");
		expect(settled()?.cancelled).toBe(false);
		expect(settled()?.unanswered).toEqual([1]);
		expect(settled()?.answers).toHaveLength(1);
	});

	it("never renders a line wider than the terminal", () => {
		const { component } = create();
		const type = (text: string) => {
			for (const ch of text) component.handleInput(ch);
		};
		const widths = [12, 30, 60, 80];
		const check = () => {
			for (const width of widths) {
				for (const line of component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		};
		check();
		component.handleInput("o");
		type("长".repeat(120)); // inline field with wide characters
		check();
		component.handleInput("\u001b[A"); // leave the row: plain label with unsaved marker
		check();
		component.handleInput("n");
		type("x".repeat(200));
		component.handleInput("\r");
		check(); // long per-question note
		component.handleInput("\t");
		component.handleInput("\t");
		component.handleInput("n");
		type("y".repeat(200));
		component.handleInput("\r");
		check(); // review tab with a long global note
		component.handleInput("\u001b");
		check(); // cancel confirmation
	});

	it("does not submit a single-select question on Space", () => {
		let settled: QuestionnaireResult | undefined;
		const component = new QuestionnaireComponent(tui, theme, [questions[0]!], (result) => {
			settled = result;
		});
		component.handleInput(" ");
		expect(settled).toBeUndefined();
	});

	it("confirms before cancelling from the collapsed state and restores the editor", () => {
		const { component, settled } = create();
		component.handleInput("o"); // jump to the free-text row
		component.handleInput("\u0007"); // Ctrl+G: full editor
		type(component, "draft");
		component.handleInput("\u001d"); // collapse
		component.handleInput("\u001b"); // Esc while collapsed
		expect(settled()).toBeUndefined();
		expect(component.render(80).join("\n")).toContain("Cancel this questionnaire?");
		component.handleInput("\r"); // "Keep answering" is focused by default
		const text = component.render(80).join("\n");
		expect(text).toContain("Type your answer");
		expect(text).toContain("draft");
	});

	describe("inline free-text row", () => {
		const down = "\u001b[B";
		const up = "\u001b[A";

		function onTypeRow() {
			const ctx = create();
			ctx.component.handleInput(down);
			ctx.component.handleInput(down); // Postgres, SQLite, Type something.
			return ctx;
		}

		it("takes typing as soon as the row is focused, shortcuts included", () => {
			const { component, settled } = onTypeRow();
			type(component, "n1 o");
			component.handleInput("\u001b[D"); // ← moves the text cursor, not the tab
			component.handleInput("x");
			expect(component.render(80).join("\n")).toContain("Question 1/2");
			component.handleInput(up); // leave the row to read the plain label
			expect(component.render(80).join("\n")).toContain("Type something. — n1 xo");
			expect(settled()).toBeUndefined();
		});

		it("commits a single-select answer on Enter and advances", () => {
			const { component } = onTypeRow();
			type(component, "MySQL");
			component.handleInput("\r");
			expect(component.render(80).join("\n")).toContain("Which features?");
			component.handleInput("\t"); // review
			expect(component.render(80).join("\n")).toContain("DB → MySQL");
		});

		it("keeps the chosen option until Enter, and keeps text when leaving", () => {
			const { component } = create();
			component.handleInput("1"); // choose Postgres, advance to question 2
			component.handleInput("\u001b[Z"); // Shift+Tab back to question 1
			component.handleInput(down);
			component.handleInput(down);
			type(component, "maybe");
			component.handleInput(up); // leave without Enter
			const text = component.render(80).join("\n");
			expect(text).toContain("◉ 1. Postgres");
			expect(text).toContain("Type something. — maybe");
			expect(text).toContain("not confirmed");
			component.handleInput(down); // back onto the row: text is still there
			type(component, "!");
			expect(component.render(80).join("\n")).toContain("maybe!");
		});

		it("adds text to a multi-select answer and stays", () => {
			const { component } = create();
			component.handleInput("1"); // answer question 1
			component.handleInput(" "); // check Auth
			component.handleInput("o");
			type(component, "Logs");
			component.handleInput("\r");
			expect(component.render(80).join("\n")).toContain("Which features?");
			component.handleInput(down); // to Next
			const text = component.render(80).join("\n");
			expect(text).toContain("◉ Type something. — Logs");
			expect(text).not.toContain("not confirmed");
			component.handleInput("\t");
			expect(component.render(80).join("\n")).toContain("Features → Auth, Logs");
		});

		it("routes Esc to the cancel confirmation and keeps the text", () => {
			const { component, settled } = onTypeRow();
			type(component, "half");
			component.handleInput("\u001b");
			expect(component.render(80).join("\n")).toContain("Cancel this questionnaire?");
			component.handleInput("\u001b"); // back
			expect(settled()).toBeUndefined();
			type(component, "way");
			expect(component.render(80).join("\n")).toContain("halfway");
		});

		it("opens the full editor with the pending text and discards it on Esc", () => {
			const { component } = onTypeRow();
			type(component, "draft");
			component.handleInput("\u0007");
			expect(component.render(80).join("\n")).toContain("Type your answer");
			type(component, " more");
			component.handleInput("\u001b"); // discard editor changes
			const text = component.render(80).join("\n");
			expect(text).not.toContain("draft more");
			expect(text).toContain("draft");
		});

		it("lands on the first option, not the text row, after switching questions", () => {
			const { component } = onTypeRow();
			component.handleInput("\t");
			component.handleInput("\u001b[Z");
			component.handleInput("1");
			expect(component.render(80).join("\n")).toContain("Which features?");
		});
	});

	it("ignores an empty Next on a lone multi-select question", () => {
		let settled: QuestionnaireResult | undefined;
		const component = new QuestionnaireComponent(tui, theme, [questions[1]!], (result) => {
			settled = result;
		});
		component.handleInput("5"); // Auth, Cache, Search, Type something, Next
		expect(settled).toBeUndefined();
		component.handleInput("1");
		component.handleInput("5");
		expect(settled?.answers[0]).toMatchObject({ selected: ["Auth"] });
	});

	it("cancels only after confirmation", () => {
		const { component, settled } = create();
		component.handleInput("\u001b");
		expect(settled()).toBeUndefined();
		component.handleInput("\u001b[A");
		component.handleInput("\r");
		expect(settled()?.cancelled).toBe(true);
	});
});

describe("QuestionnaireComponent replay", () => {
	const submitted: QuestionnaireResult = {
		answers: [
			{ questionIndex: 0, question: "Which database?", kind: "option", answer: "SQLite", notes: "local first" },
			{ questionIndex: 1, question: "Which features?", kind: "multi", answer: "Billing", selected: ["Auth", "Search"] },
		],
		cancelled: false,
		globalNote: "ship it",
	};

	function replay(result: QuestionnaireResult = submitted) {
		let closed = 0;
		const component = new QuestionnaireComponent(tui, theme, questions, () => (closed += 1), undefined, { replay: result });
		return { component, closed: () => closed };
	}

	it("shows the answers as submitted, in green and without a cursor", () => {
		const lines = replay().component.render(80);
		const text = lines.join("\n");
		expect(lines).toContain("    ◉ 2. SQLite");
		expect(text).not.toContain("▎");
		expect(text).not.toContain(SURFACE);
		expect(text).toContain("local first");
		expect(text).toContain("ship it");
		expect(text).not.toMatch(/Review|检查/);
		// No previews here: ↑↓ would do nothing, so the hint leaves them out.
		expect(lines.at(-1)).toBe("←→ switch · Esc close");
	});

	it("steps through the previews with ↑/↓, naming the option on the divider", () => {
		const withPreviews: AskQuestion[] = [
			{
				question: "Which layout?",
				header: "Layout",
				options: [
					{ label: "Grid", description: "Cards.", preview: "GRID PREVIEW" },
					{ label: "List", description: "Rows." },
					{ label: "Table", description: "Columns.", preview: "TABLE PREVIEW" },
				],
			},
		];
		const result: QuestionnaireResult = {
			answers: [{ questionIndex: 0, question: "Which layout?", kind: "option", answer: "Table" }],
			cancelled: false,
		};
		const component = new QuestionnaireComponent(tui, theme, withPreviews, () => {}, undefined, { replay: result });
		const shown = () => component.render(80).join("\n");
		// Opens on the answer's preview.
		expect(shown()).toContain("─ Preview · 3. Table ─");
		expect(shown()).toContain("TABLE PREVIEW");
		expect(component.render(80).at(-1)).toBe("↑↓ switch preview · Esc close");
		// List has no preview and is skipped.
		component.handleInput("\u001b[A");
		expect(shown()).toContain("─ Preview · 1. Grid ─");
		component.handleInput("\u001b[A");
		expect(shown()).toContain("TABLE PREVIEW");
		component.handleInput("\u001b[B");
		expect(shown()).toContain("GRID PREVIEW");
		expect(shown()).not.toContain("▎");
	});

	it("switches questions with ←/→ and never changes the answer", () => {
		const { component, closed } = replay();
		for (const key of ["1", " ", "n", "o", "x"]) component.handleInput(key);
		expect(component.render(80).join("\n")).toContain("◉ 2. SQLite");
		component.handleInput("\u001b[C");
		const second = component.render(80).join("\n");
		expect(second).toContain("Which features?");
		expect(second).toContain("☑ 1. Auth");
		expect(second).toContain("☐ 2. Cache");
		expect(second).toContain("☑ 3. Search");
		expect(second).toContain("Billing");
		expect(second).not.toMatch(/Next|下一题/);
		component.handleInput("\u001b[C");
		expect(component.render(80).join("\n")).toContain("Which database?");
		expect(closed()).toBe(0);
	});

	it("closes on Esc without a confirmation", () => {
		const { component, closed } = replay();
		component.handleInput("\u001b");
		expect(closed()).toBe(1);
	});

	it("opens a declined questionnaire with nothing chosen", () => {
		const text = replay({ answers: [], cancelled: true }).component.render(80).join("\n");
		expect(text).toContain("Which database?");
		expect(text).not.toContain("◉");
	});
});
