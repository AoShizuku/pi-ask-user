import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collapseKey, DEFAULT_CONFIG, keyLabel, loadConfig, normalizeKeyId, setActiveConfig } from "./config.js";
import { detectLocale, t } from "./i18n.js";
import { createSettingsProvider } from "./settings.js";

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-ask-user-settings-"));
	path = join(dir, "pi-ask-user.json");
	setActiveConfig(DEFAULT_CONFIG);
});

afterEach(() => {
	setActiveConfig(DEFAULT_CONFIG);
	rmSync(dir, { recursive: true, force: true });
});

describe("normalizeKeyId", () => {
	it("accepts key ids with a modifier and spells them like pi-tui", () => {
		expect(normalizeKeyId("Ctrl+]")).toBe("ctrl+]");
		expect(normalizeKeyId("alt+shift+c")).toBe("alt+shift+c");
		expect(normalizeKeyId("ctrl++")).toBe("ctrl++");
		expect(normalizeKeyId("alt+pagedown")).toBe("alt+pageDown");
		expect(normalizeKeyId("f2")).toBe("f2");
	});

	it("refuses bare printable keys, unknown names and repeated modifiers", () => {
		for (const bad of ["c", "]", "", "ctrl+", "ctrl+shift", "hyper+c", "ctrl+ctrl+c", "ctrl+foo"]) {
			expect(normalizeKeyId(bad)).toBeUndefined();
		}
	});

	it("labels keys for hint lines", () => {
		expect(keyLabel("ctrl+]")).toBe("Ctrl+]");
		expect(keyLabel("ctrl++")).toBe("Ctrl++");
	});
});

describe("settings provider", () => {
	it("lists language and collapse key, locked by the environment when set", () => {
		const provider = createSettingsProvider(path, { PI_ASK_USER_LOCALE: "zh_CN", PI_ASK_USER_COLLAPSE_KEY: "Alt+K" });
		const items = provider.items();
		expect(items.map((item) => [item.id, item.kind, "value" in item ? item.value : undefined, item.locked])).toEqual([
			["locale", "enum", "zh", "set by PI_ASK_USER_LOCALE"],
			["collapseKey", "text", "alt+k", "set by PI_ASK_USER_COLLAPSE_KEY"],
		]);
		expect(provider.set("locale", "en")).toEqual({ ok: false, error: "Language is set by PI_ASK_USER_LOCALE" });
		expect(provider.set("collapseKey", "ctrl+k").ok).toBe(false);
	});

	it("saves valid values, applies them at once and refuses invalid ones", () => {
		const provider = createSettingsProvider(path, {});
		expect(provider.items().every((item) => item.locked === undefined)).toBe(true);

		expect(provider.set("locale", "zh")).toEqual({ ok: true });
		expect(provider.set("collapseKey", "Alt+C")).toEqual({ ok: true });
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ locale: "zh", collapseKey: "alt+c" });
		expect(loadConfig(path)).toEqual({ locale: "zh", collapseKey: "alt+c" });
		expect(collapseKey({})).toBe("alt+c");
		expect(detectLocale({})).toBe("zh");

		expect(provider.set("locale", "fr").ok).toBe(false);
		expect(provider.set("collapseKey", "c").ok).toBe(false);
		expect(provider.set("nope", true).ok).toBe(false);

		// Empty text resets to the default.
		expect(provider.set("collapseKey", "")).toEqual({ ok: true });
		expect(collapseKey({})).toBe("ctrl+]");
	});

	it("keeps PI_ASK_USER_LOCALE above the file", () => {
		setActiveConfig({ ...DEFAULT_CONFIG, locale: "zh" });
		// vitest.config pins PI_ASK_USER_LOCALE=en.
		expect(t("ask.title")).toBe("Ask");
		expect(detectLocale({ LANG: "en_US" })).toBe("zh");
	});

	it("falls back to defaults for a broken file", () => {
		expect(loadConfig(join(dir, "missing.json"))).toEqual(DEFAULT_CONFIG);
	});
});
