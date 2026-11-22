// Plugin configuration: <agent dir>/pi-ask-user.json (global only). Each value is decided by its environment
// variable first, then the file, then the default (DESIGN.md §4). A missing or unreadable file, or a field of the
// wrong type, falls back to the default.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILE_NAME = "pi-ask-user.json";
export const LOCALE_ENV = "PI_ASK_USER_LOCALE";
export const COLLAPSE_KEY_ENV = "PI_ASK_USER_COLLAPSE_KEY";

export const LOCALE_PREFERENCES = ["auto", "en", "zh"] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export interface AskUserConfig {
	/** auto follows LC_ALL / LC_MESSAGES / LANG, then the OS locale. */
	locale: LocalePreference;
	/** Folds the questionnaire to its top edge; a pi-tui key id such as `ctrl+]`. */
	collapseKey: string;
}

export const DEFAULT_CONFIG: AskUserConfig = { locale: "auto", collapseKey: "ctrl+]" };

export type Env = Record<string, string | undefined>;

export function getConfigPath(): string {
	return join(getAgentDir(), CONFIG_FILE_NAME);
}

/** `zh`, `zh-CN`, `en_US` … → the UI language; anything else is not an explicit choice. */
export function parseLocale(value: string | undefined): "en" | "zh" | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "zh" || normalized.startsWith("zh-") || normalized.startsWith("zh_")) return "zh";
	if (normalized === "en" || normalized.startsWith("en-") || normalized.startsWith("en_")) return "en";
	return undefined;
}

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);
const SYMBOLS = new Set([..."`-=[]\\;',./!@#$%^&*()_+|~{}:<>?"]);
const SPECIAL: Record<string, string> = Object.fromEntries(
	[
		"escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear", "home", "end",
		"pageUp", "pageDown", "up", "down", "left", "right",
		...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
	].map((name) => [name.toLowerCase(), name]),
);

/**
 * Normalize a key id the way pi-tui's `KeyId` spells it (`ctrl+]`, `alt+pageDown`), or undefined when it is not one.
 * A bare printable key is refused: the questionnaire has a free-text row, and the key would be typed there instead.
 */
export function normalizeKeyId(value: string): string | undefined {
	const text = value.trim().toLowerCase();
	if (!text) return undefined;
	// The base key may itself be "+" (`ctrl++`), so take it from the end before splitting the modifiers.
	const base = text.endsWith("++") ? "+" : text.slice(text.lastIndexOf("+") + 1);
	const head = text.slice(0, text.length - base.length);
	const modifiers = head === "" ? [] : head.slice(0, -1).split("+");
	if (head !== "" && !head.endsWith("+")) return undefined;
	if (modifiers.some((modifier) => !MODIFIERS.has(modifier)) || new Set(modifiers).size !== modifiers.length) return undefined;
	let key: string;
	if (/^[a-z0-9]$/.test(base) || SYMBOLS.has(base)) key = base;
	else if (SPECIAL[base] !== undefined) key = SPECIAL[base];
	else return undefined;
	if (modifiers.length === 0 && !/^f\d+$/.test(key)) return undefined;
	return [...modifiers, key].join("+");
}

export function loadConfig(path = getConfigPath()): AskUserConfig {
	try {
		if (!existsSync(path)) return { ...DEFAULT_CONFIG };
		return normalize(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(config: AskUserConfig, path = getConfigPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function normalize(value: unknown): AskUserConfig {
	const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const locale = (LOCALE_PREFERENCES as readonly unknown[]).includes(source.locale)
		? (source.locale as LocalePreference)
		: DEFAULT_CONFIG.locale;
	const collapseKey = typeof source.collapseKey === "string" ? normalizeKeyId(source.collapseKey) : undefined;
	return { locale, collapseKey: collapseKey ?? DEFAULT_CONFIG.collapseKey };
}

/** The env value that decides the locale, or undefined when the file / default decides it. */
export function lockedLocale(env: Env = process.env): "en" | "zh" | undefined {
	return parseLocale(env[LOCALE_ENV]);
}

/** The env value that decides the collapse key (unvalidated, as before), or undefined. */
export function lockedCollapseKey(env: Env = process.env): string | undefined {
	return env[COLLAPSE_KEY_ENV]?.trim().toLowerCase() || undefined;
}

// ---------------------------------------------------------------- live state

let active: AskUserConfig = { ...DEFAULT_CONFIG };

/** What the file says now (read at extension load, updated by the settings panel). */
export function activeConfig(): AskUserConfig {
	return active;
}

export function setActiveConfig(config: AskUserConfig): void {
	active = { ...config };
}

/** The collapse key in effect: the environment variable, then the file, then the default. */
export function collapseKey(env: Env = process.env): string {
	return lockedCollapseKey(env) ?? active.collapseKey;
}

/** `ctrl+]` → `Ctrl+]`, for hint lines. */
export function keyLabel(key: string): string {
	const base = key.endsWith("++") ? "+" : key.slice(key.lastIndexOf("+") + 1);
	const modifiers = key.length > base.length ? key.slice(0, key.length - base.length - 1).split("+") : [];
	return [...modifiers, base]
		.map((part) => (part.length > 1 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part.toUpperCase()))
		.join("+");
}
