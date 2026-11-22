// The pi-ask-user page of the /shizuku settings panel (DESIGN.md §4).

import {
	activeConfig,
	COLLAPSE_KEY_ENV,
	DEFAULT_CONFIG,
	type Env,
	keyLabel,
	LOCALE_ENV,
	LOCALE_PREFERENCES,
	type LocalePreference,
	lockedCollapseKey,
	lockedLocale,
	normalizeKeyId,
	saveConfig,
	setActiveConfig,
} from "./config.js";
import type { SetResult, SettingItem, SettingsProvider, SettingValue } from "./shizuku-settings.js";

/** Synchronous set(), which the tests rely on. */
export type AskUserSettingsProvider = Omit<SettingsProvider, "set"> & { set(id: string, value: SettingValue): SetResult };

export function createSettingsProvider(path: string, env: Env = process.env): AskUserSettingsProvider {
	return {
		id: "pi-ask-user",
		title: "pi-ask-user",
		description: "Structured questions: language and collapse key",
		file: path,
		items(): SettingItem[] {
			const config = activeConfig();
			const envLocale = lockedLocale(env);
			const envKey = lockedCollapseKey(env);
			return [
				{
					id: "locale",
					kind: "enum",
					label: "Language",
					description: "UI language of the questionnaire. auto follows LC_ALL / LC_MESSAGES / LANG, then the OS locale.",
					values: LOCALE_PREFERENCES,
					value: envLocale ?? config.locale,
					default: DEFAULT_CONFIG.locale,
					...(envLocale ? { locked: `set by ${LOCALE_ENV}` } : {}),
				},
				{
					id: "collapseKey",
					kind: "text",
					label: "Collapse key",
					description: `Folds the questionnaire to one line (shown as ${keyLabel(envKey ?? config.collapseKey)}). A key id with a modifier, e.g. ctrl+], alt+c.`,
					value: envKey ?? config.collapseKey,
					default: DEFAULT_CONFIG.collapseKey,
					placeholder: DEFAULT_CONFIG.collapseKey,
					...(envKey ? { locked: `set by ${COLLAPSE_KEY_ENV}` } : {}),
				},
			];
		},
		set(id: string, value: SettingValue): SetResult {
			const config = { ...activeConfig() };
			if (id === "locale") {
				if (lockedLocale(env)) return { ok: false, error: `Language is set by ${LOCALE_ENV}` };
				if (typeof value !== "string" || !(LOCALE_PREFERENCES as readonly string[]).includes(value)) {
					return { ok: false, error: `Language must be one of ${LOCALE_PREFERENCES.join(", ")}` };
				}
				config.locale = value as LocalePreference;
			} else if (id === "collapseKey") {
				if (lockedCollapseKey(env)) return { ok: false, error: `Collapse key is set by ${COLLAPSE_KEY_ENV}` };
				const text = typeof value === "string" && value.trim() !== "" ? value : DEFAULT_CONFIG.collapseKey;
				const key = normalizeKeyId(text);
				if (!key) return { ok: false, error: `Not a key with a modifier: ${String(value)}` };
				config.collapseKey = key;
			} else {
				return { ok: false, error: `Unknown setting: ${id}` };
			}
			try {
				saveConfig(config, path);
			} catch (error) {
				return { ok: false, error: `Cannot save ${path}: ${(error as Error).message}` };
			}
			setActiveConfig(config);
			return { ok: true };
		},
	};
}
