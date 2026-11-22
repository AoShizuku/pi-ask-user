import { describe, expect, it } from "vitest";

import { hasDialogUI, runRpcQuestionnaire, type DialogUI } from "./rpc.js";
import type { AskQuestion } from "./types.js";

const single: AskQuestion = {
	question: "Which?",
	header: "Pick",
	options: [
		{ label: "A", description: "a" },
		{ label: "B", description: "b" },
	],
};

const multi: AskQuestion = {
	question: "Which ones?",
	header: "Many",
	multiSelect: true,
	options: [
		{ label: "X", description: "x" },
		{ label: "Y", description: "y" },
		{ label: "Z", description: "z" },
	],
};

type Step = { kind: "select" | "input"; answer: string | undefined };

function ui(steps: Step[]): DialogUI {
	const next = (kind: Step["kind"]) => {
		const step = steps.shift();
		if (!step || step.kind !== kind) throw new Error(`unexpected ${kind}`);
		return step.answer;
	};
	return {
		select: async () => next("select"),
		input: async () => next("input"),
	};
}

describe("runRpcQuestionnaire", () => {
	it("maps a selected line to an option answer", async () => {
		const result = await runRpcQuestionnaire(ui([{ kind: "select", answer: "2. B — b" }]), [single]);
		expect(result).toEqual({
			answers: [{ questionIndex: 0, question: "Which?", kind: "option", answer: "B" }],
			cancelled: false,
		});
	});

	it("opens the free-text input for the appended Other row", async () => {
		const result = await runRpcQuestionnaire(
			ui([
				{ kind: "select", answer: "3. ◌ Type something." },
				{ kind: "input", answer: "  mine  " },
			]),
			[single],
		);
		expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "mine" });
	});

	it("returns to the options when the Other input is blank", async () => {
		const result = await runRpcQuestionnaire(
			ui([
				{ kind: "select", answer: "3. ◌ Type something." },
				{ kind: "input", answer: "   " },
				{ kind: "select", answer: "1. A — a" },
			]),
			[single],
		);
		expect(result.answers[0]).toMatchObject({ kind: "option", answer: "A" });
	});

	it("parses numbered multi-select input with custom text", async () => {
		const result = await runRpcQuestionnaire(ui([{ kind: "input", answer: "1,3; custom" }]), [multi]);
		expect(result.answers[0]).toEqual({
			questionIndex: 0,
			question: "Which ones?",
			kind: "multi",
			answer: "custom",
			selected: ["X", "Z"],
		});
	});

	it("keeps unparseable multi-select input as custom text", async () => {
		const result = await runRpcQuestionnaire(ui([{ kind: "input", answer: "all of them" }]), [multi]);
		expect(result.answers[0]).toMatchObject({ kind: "multi", answer: "all of them", selected: [] });
	});

	it("dedupes and sorts numbered multi-select input", async () => {
		const result = await runRpcQuestionnaire(ui([{ kind: "input", answer: "3,1,3" }]), [multi]);
		expect(result.answers[0]).toMatchObject({ selected: ["X", "Z"], answer: null });
	});

	it("asks again when an option number is out of range", async () => {
		const titles: string[] = [];
		const replies = ["1,5", "2"];
		const result = await runRpcQuestionnaire(
			{
				select: async () => undefined,
				input: async (title) => {
					titles.push(title);
					return replies.shift();
				},
			},
			[multi],
		);
		expect(result.answers[0]).toMatchObject({ selected: ["Y"] });
		expect(titles[1]).toContain("Option numbers must be 1-3");
	});

	it("cancels the whole questionnaire when a dialog is dismissed", async () => {
		const result = await runRpcQuestionnaire(ui([{ kind: "select", answer: undefined }]), [single]);
		expect(result).toMatchObject({ cancelled: true, answers: [] });
	});
});

describe("hasDialogUI", () => {
	it("requires both select and input", () => {
		expect(hasDialogUI({ select: () => undefined, input: () => undefined })).toBe(true);
		expect(hasDialogUI({ select: () => undefined })).toBe(false);
		expect(hasDialogUI(null)).toBe(false);
	});
});
