import { activeConfig, type Env, LOCALE_ENV, type LocalePreference, parseLocale } from "./config.js";

export type Locale = "en" | "zh";

const ZH = {
	"ask.title": "提问",
	"ask.progress": "第 {current}/{total} 题",
	"ask.reviewTab": "检查",
	"ask.answered": "已答",
	"ask.noQuestions": "没有需要回答的问题。",
	"ask.waiting": "等待你的回答",
	"sentinel.typeSomething": "自己输入",
	"sentinel.next": "下一题",
	"review.heading": "检查你的回答",
	"review.submit": "提交回答",
	"review.submitUnanswered": "仍有 {count} 题未答，提交",
	"review.globalNote": "整体备注",
	"review.jumpHint": "选择一行可回到该题",
	"notes.title": "为这个回答添加备注",
	"notes.globalTitle": "整体备注",
	"custom.title": "输入你的回答",
	"confirm.cancelTitle": "取消这次提问？",
	"confirm.cancelBody": "已填写但未提交的回答会被丢弃。",
	"confirm.cancelYes": "取消提问",
	"confirm.cancelNo": "继续回答",
	"confirm.submitTitle": "仍有未回答的问题",
	"confirm.submitBody": "可以继续提交，未答的题会在结果中标注。",
	"confirm.submitYes": "仍然提交",
	"confirm.submitNo": "返回检查",
	"hint.browse": "↑↓ 移动 · 数字 选择 · Enter 确认 · Tab 切题 · n 备注 · o 跳到输入行 · {key} 收起 · Esc 取消",
	"hint.multi": "↑↓ 移动 · Space 勾选 · Enter 勾选/下一题 · Tab 切题 · n 备注 · o 跳到输入行 · {key} 收起 · Esc 取消",
	"hint.review": "↑↓ 移动 · Enter 选择/提交 · Tab 切题 · n 整体备注 · Esc 取消",
	"hint.inline": "直接输入 · Enter 确认 · ↑↓ 移动 · Tab 切题 · Ctrl+G 多行编辑 · {key} 收起 · Esc 取消",
	"hint.editor": "Enter 保存 · Esc 返回",
	"hint.collapsed": "已收起 · {key} 展开",
	"hint.confirm": "Enter 确认 · Esc 返回",
	"hint.preview": "预览",
	"hint.replaySwitch": "←→ 切题",
	"hint.replayPreview": "↑↓ 切换预览",
	"hint.replayClose": "Esc 关闭",
	"replay.title": "提问 · 回看",
	"replay.readonly": "只读",
	"answer.unanswered": "未回答",
	"answer.note": "备注",
	"custom.unsaved": "未确认，按 Enter 生效",
	"rpc.invalidSelection": "选项编号只能是 1-{max}，请重新输入。",
	"fallback.dialogs": "问卷界面加载失败（{error}），改用逐题对话框。",
} as const;

const EN: Record<keyof typeof ZH, string> = {
	"ask.title": "Ask",
	"ask.progress": "Question {current}/{total}",
	"ask.reviewTab": "Review",
	"ask.answered": "answered",
	"ask.noQuestions": "Nothing to ask.",
	"ask.waiting": "Waiting for your answer",
	"sentinel.typeSomething": "Type something.",
	"sentinel.next": "Next",
	"review.heading": "Review your answers",
	"review.submit": "Submit answers",
	"review.submitUnanswered": "Submit with {count} unanswered",
	"review.globalNote": "Global note",
	"review.jumpHint": "Select a row to return to that question",
	"notes.title": "Note for this answer",
	"notes.globalTitle": "Global note",
	"custom.title": "Type your answer",
	"confirm.cancelTitle": "Cancel this questionnaire?",
	"confirm.cancelBody": "Answers you entered but did not submit will be discarded.",
	"confirm.cancelYes": "Cancel questionnaire",
	"confirm.cancelNo": "Keep answering",
	"confirm.submitTitle": "Some questions are unanswered",
	"confirm.submitBody": "You can submit anyway; the result will name the unanswered questions.",
	"confirm.submitYes": "Submit anyway",
	"confirm.submitNo": "Go back",
	"hint.browse": "↑↓ move · digits select · Enter confirm · Tab switch · n note · o jump to text · {key} collapse · Esc cancel",
	"hint.multi": "↑↓ move · Space toggle · Enter toggle/next · Tab switch · n note · o jump to text · {key} collapse · Esc cancel",
	"hint.review": "↑↓ move · Enter select/submit · Tab switch · n global note · Esc cancel",
	"hint.inline": "type · Enter confirm · ↑↓ move · Tab switch · Ctrl+G multi-line · {key} collapse · Esc cancel",
	"hint.editor": "Enter save · Esc return",
	"hint.collapsed": "hidden · {key} expand",
	"hint.confirm": "Enter confirm · Esc back",
	"hint.preview": "Preview",
	"hint.replaySwitch": "←→ switch",
	"hint.replayPreview": "↑↓ switch preview",
	"hint.replayClose": "Esc close",
	"replay.title": "Ask · replay",
	"replay.readonly": "read-only",
	"answer.unanswered": "Unanswered",
	"answer.note": "Note",
	"custom.unsaved": "not confirmed; press Enter",
	"rpc.invalidSelection": "Option numbers must be 1-{max}; try again.",
	"fallback.dialogs": "Questionnaire UI failed ({error}); falling back to one dialog per question.",
};

/**
 * The UI language: PI_ASK_USER_LOCALE first, then the `locale` in pi-ask-user.json, then LC_ALL / LC_MESSAGES /
 * LANG, then the OS locale. Read on every lookup, so a change from the settings panel shows on the next render.
 */
export function detectLocale(env: Env = process.env, preference: LocalePreference = activeConfig().locale): Locale {
	const explicit = parseLocale(env[LOCALE_ENV]);
	if (explicit) return explicit;
	if (preference !== "auto") return preference;
	// Windows rarely sets LANG/LC_*; fall back to the ICU system locale there.
	const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || systemLocale();
	return /^zh/i.test(raw) ? "zh" : "en";
}

let cachedSystemLocale: string | undefined;

/** Cached: t() runs on every render, and the OS locale does not change while pi runs. */
function systemLocale(): string {
	if (cachedSystemLocale !== undefined) return cachedSystemLocale;
	try {
		cachedSystemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		cachedSystemLocale = "";
	}
	return cachedSystemLocale;
}

export type StringKey = keyof typeof ZH;

export function t(key: StringKey, vars?: Record<string, string | number>): string {
	let text = (detectLocale() === "zh" ? ZH : EN)[key];
	if (!vars) return text;
	for (const [name, value] of Object.entries(vars)) {
		text = text.replaceAll(`{${name}}`, String(value));
	}
	return text;
}
