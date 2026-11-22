import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import askUserPlugin from "./index.js";
import { TOOL_NAME } from "./schema.js";

interface FakeTool {
	name: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: { properties?: Record<string, unknown>; required?: string[] };
	prepareArguments?: (args: unknown) => unknown;
	execute: (
		id: string,
		params: any,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ExtensionToolContext,
	) => Promise<{ content: Array<{ text: string }>; details: unknown; isError?: boolean }>;
}

function fakePi() {
	let active = ["bash", TOOL_NAME];
	const tools: FakeTool[] = [];
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const pi = {
		registerTool(tool: FakeTool) {
			tools.push(tool);
		},
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => undefined;
		},
		events: { on: () => () => undefined, emit: () => undefined },
		getActiveTools: () => [...active],
		setActiveTools(names: string[]) {
			active = [...names];
		},
	} as unknown as ExtensionAPI;
	return { pi, tools, handlers, active: () => active };
}

const validParams = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
	],
};

describe("plugin registration", () => {
	it("registers one compact tool with the expected schema", () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		expect(tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
		const tool = tools[0]!;
		expect(tool.parameters.required).toEqual(["questions"]);
		const metadata = JSON.stringify({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			promptSnippet: tool.promptSnippet,
			promptGuidelines: tool.promptGuidelines,
		});
		expect(metadata.length).toBeLessThanOrEqual(1_600);
	});

	it("repairs a flat single question before schema validation", () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		const prepared = tools[0]!.prepareArguments!({ ...validParams.questions[0] }) as typeof validParams;
		expect(prepared.questions).toHaveLength(1);
	});

	it("hides the tool without UI and restores it when UI returns", () => {
		const { pi, handlers, active } = fakePi();
		askUserPlugin(pi);
		const before = handlers.get("before_agent_start")![0]!;
		before({}, { hasUI: false });
		expect(active()).toEqual(["bash"]);
		before({}, { hasUI: true });
		expect(active()).toEqual(["bash", TOOL_NAME]);
	});

	it("never re-activates a tool the user or another extension turned off", () => {
		const { pi, handlers, active } = fakePi();
		askUserPlugin(pi);
		const before = handlers.get("before_agent_start")![0]!;
		pi.setActiveTools(["bash"]);
		before({}, { hasUI: true, mode: "tui" });
		expect(active()).toEqual(["bash"]);
	});

	it("runs the RPC dialog walker and returns a structured result", async () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		const tool = tools[0]!;
		const ctx = {
			hasUI: true,
			mode: "rpc",
			ui: {
				select: async () => "1. A — a",
				input: async () => "",
			},
		} as unknown as ExtensionToolContext;
		const result = await tool.execute("call-2", validParams, undefined, undefined, ctx);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain('"Which?"="A"');
		expect((result.details as { answers: unknown[] }).answers).toHaveLength(1);
	});

	it("falls back to native dialogs when custom UI fails, and says so", async () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		const tool = tools[0]!;
		const notices: string[] = [];
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				custom: async () => {
					throw new Error("custom UI unavailable");
				},
				select: async () => "1. A — a",
				input: async () => "",
				notify: (message: string) => notices.push(message),
			},
		} as unknown as ExtensionToolContext;
		const result = await tool.execute("call-3", validParams, undefined, undefined, ctx);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain('"Which?"="A"');
		expect(notices[0]).toContain("custom UI unavailable");
	});

	it("reports a rendering failure as an error, not a decline", async () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		const tool = tools[0]!;
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: { custom: async () => undefined },
		} as unknown as ExtensionToolContext;
		const result = await tool.execute("call-4", validParams, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("cannot render");
	});

	it("returns an explicit no-UI error instead of a decline", async () => {
		const { pi, tools } = fakePi();
		askUserPlugin(pi);
		const tool = tools[0]!;
		const ctx = { hasUI: false, mode: "tui", ui: {} } as unknown as ExtensionToolContext;
		const result = await tool.execute("call-1", validParams, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("never saw the questions");
	});
});
