# pi-ask-user

Structured questionnaires for pi: the model asks one to four questions, you answer with options, multi-select, free text, and notes, and the tool returns a structured result in the same turn.

This is a synchronous tool. It does not end the turn or persist a request; if the process dies, the question is gone. That trade-off keeps the implementation small and keeps the answer in the model's normal tool-result channel.

## Features

- 1–4 questions per call, 2–4 options per question.
- Single-select, multi-select, and a runtime-appended free-text row.
- Per-question notes and a global note on the review tab.
- Optional markdown `preview` for single-select options (rendered below the options).
- Tabbed multi-question flow with a review step and back navigation.
- `Ctrl+]` collapses the dialog to one row and restores it.
- A transcript row that shows every answer at a glance, and reopens the questionnaire read-only on click.
- Graceful RPC/ACP fallback through the host's native `select`/`input` dialogs.
- Non-interactive sessions remove the tool from the model's tool list.
- External answer events for phone/web bridges and test harnesses.
- English and Chinese UI chrome, selected from `PI_ASK_USER_LOCALE` or the process locale.
- Compact model-facing metadata: about 1.5k characters (~384 tokens by `chars / 4`).

## Install

From the repository root:

```bash
pi install npm:@aoshizuku/pi-ask-user                # 从 npm 安装
pi install git:github.com/AoShizuku/pi-ask-user     # 或从 GitHub 安装
pi install ./pi-ask-user
```

Or load it explicitly for one run:

```bash
pi --extension ./pi-ask-user/src/index.ts
```

The package declares `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as peers; pi supplies its own copies at runtime.

Do not load this alongside `@juicesharp/rpiv-ask-user-question`: both register the `ask_user_question` tool, and pi will report a tool-name collision.

## Tool contract

Tool name: `ask_user_question`.

```jsonc
{
  "questions": [
    {
      "question": "Which database should we use?",
      "header": "Database",
      "options": [
        { "label": "Postgres (Recommended)", "description": "Managed, familiar, strong SQL support." },
        { "label": "SQLite", "description": "No server; simplest local setup." }
      ]
    },
    {
      "question": "Which features should ship first?",
      "header": "Features",
      "multiSelect": true,
      "options": [
        { "label": "Auth", "description": "Sign-in and accounts." },
        { "label": "Search", "description": "Full-text search." }
      ]
    }
  ]
}
```

Limits:

| Field | Limit |
|---|---|
| `questions` | 1–4 |
| `questions[].header` | 16 characters |
| `questions[].options` | 2–4 |
| `options[].label` | 60 characters |
| `options[].description` | required, one sentence recommended |
| `options[].preview` | optional, single-select only |

The runtime appends the free-text row and, on multi-select questions, a `Next` row. Do not author `Other`, `Type something.`, or `Next`; those labels are rejected by validation.

Before schema validation the tool repairs structure only: a flat single question (including `questions: "plain question text"`), `header`/`options` beside a one-item `questions` array, double-encoded JSON strings, `"true"`/`"false"` strings for `multiSelect`, and a missing or blank `header` (derived from the question text). It never drops, truncates, or rewrites authored values, so a too-long header, a malformed question, or a wrong option count reaches the model as an error instead of being silently "fixed". After validation, text is stripped of terminal control sequences; text that strips to empty is rejected by the semantic validator.

## Result

The model receives text such as:

```text
User has answered your questions: "Which database should we use?"="Postgres (Recommended)". "Which features should ship first?"="Auth, Search". You can now continue with the user's answers in mind.
```

`details` carries the structured form:

```ts
{
  answers: Array<{
    questionIndex: number;
    question: string;
    kind: "option" | "custom" | "multi";
    answer: string | null;
    selected?: string[];
    notes?: string;
    preview?: string;
  }>;
  cancelled: boolean;
  globalNote?: string;
  unanswered?: number[];
  error?: string;
}
```

Questions, answers, notes, and the global note are JSON-quoted in that text, so user-typed quotes or newlines cannot forge extra answers. The text is always English, whatever the UI locale. A selected option's `preview` is not echoed to the model (it wrote it); `details.answers[].preview` still carries it for programmatic callers.

A cancelled questionnaire, or a submit where every question is blank and no global note exists, returns the canonical `User declined to answer questions.` signal. A rendering failure is an error, not a decline, and tells the model to ask in plain chat instead.

## Transcript row

Once answered, the tool row keeps the status on its title line and gives each question one row, keyed by its `header`:

```text
● Ask · 3 answered
  ├ Database  Postgres (Recommended) + note
  ├ Features  Auth, Search
  ├ Deploy    ✎ my own VPS
  └ note      ship fast
```

- The count is green when every question was answered and yellow (`2/3 answered`) on a partial submit, where the blank question reads `○ skipped`. A decline is a red `declined` on the title line with no rows. A submit with only a global note is not a decline (the model receives the note): it reads `0/3 answered`, every question `○ skipped`, and the note row.
- Answers are green; `✎` marks text the user typed rather than an option. `+ note` flags a per-question note, and a global note gets the last row.
- Every row stays one line, cut with `…`. `Ctrl+O` expands each row into the full question, the answer, and the note, wrapped under the header.
- Clicking a finished row reopens the questionnaire in place of the editor, read-only, as it was submitted: the chosen options and typed text in green, notes under the question, and no cursor: nothing can be chosen. The answer's preview shows first, its divider naming the option. `←`/`→` (or `Tab`) switch questions, `↑`/`↓` step through the other options' previews (questions without previews ignore them), and `Esc`, `Enter`, or `q` closes it with no confirmation. Text in the editor comes back when it closes. A new questionnaire closes an open replay first. Declined questionnaires open too, with nothing chosen.

## Keyboard

The dialog has three input modes. Which one is active depends only on where the focus is, and the hint line at the bottom always shows the keys for the current mode.

| Mode | When | Keys go to |
|---|---|---|
| Browse | Focus on an option, `Next`, or a Review row | Shortcuts below |
| Inline text | Focus on the `Type something.` row | A single-line text field on that row |
| Editor | `Ctrl+G` from the text row, or `n` for notes | pi's full multi-line `Editor` |

### Browse

| Key | Action |
|---|---|
| `↑` / `↓` | Move between options, review rows, or confirmation rows |
| `1`–`9` | Select/toggle the numbered row (on the text row's number: just focus it) |
| `Enter` | Confirm an option, toggle a multi-select option, or activate the focused row |
| `Space` | Toggle a multi-select option (does nothing on single-select) |
| `Tab` / `Shift+Tab` | Next / previous question, including the Review tab |
| `←` / `→` | Same as `Tab` / `Shift+Tab` |
| `n` | Note for the current question; global note on the Review tab |
| `o` | Jump to the `Type something.` row |
| `Ctrl+]` | Collapse / expand the dialog (configurable, see below) |
| `Esc` | Cancel, with confirmation |

### Inline text (the `Type something.` row)

Moving onto the row is enough; there is no extra `Enter` to start typing.

| Key | Action |
|---|---|
| Letters, digits, `Space`, `n`, `o` | Typed into the field; Browse shortcuts are off on this row |
| `←` / `→` | Move the text cursor (switch questions with `Tab` only) |
| `↑` / `↓` | Leave the row; the typed text is kept, not cleared |
| `Enter` | Commit the text. Single-select: it replaces the chosen option and moves on. Multi-select: it joins the checked options and focus stays. Empty text clears a previous custom answer. |
| `Tab` / `Shift+Tab` | Next / previous question |
| `Ctrl+G` | Open the full multi-line editor with the current text |
| `Ctrl+]` | Collapse / expand |
| `Esc` | Cancel confirmation, same as everywhere else; the typed text survives "Keep answering" |

Rules worth remembering:

- Typing never changes the answer by itself; only `Enter` (here or in the full editor) commits. Leaving the row with uncommitted text keeps the old answer, and the row shows the text with a "not confirmed" marker.
- On single-select, an option chosen earlier stays chosen until free text is committed.
- Switching to a question, or advancing after an answer, focuses the first option, never the text row, so a digit you press selects an option instead of being typed.
- Notes (`n`) and the global note keep the explicit editor; only the answer text is inline.
- The field is single-line; pasted newlines are dropped. Use `Ctrl+G` for multi-line answers.

### Editor

The full editor is pi's `Editor`: `Enter` saves, `Shift+Enter` inserts a newline, `Esc` discards this edit and returns. Esc from the free-text editor returns to the inline row with its text as it was before `Ctrl+G`.

### Collapse and single-question edge cases

While collapsed, `Enter` expands the dialog and `Esc` expands it into the cancel confirmation; choosing "Keep answering" returns to where you were, including an open editor or inline field with its unsaved text.

With a single multi-select question there is no review tab, so `Next` does nothing until something is selected or typed; decline with `Esc` instead.

## Host behavior

| Host | Behavior |
|---|---|
| Interactive TUI | Full dialog: tabs, review, notes, previews, collapse |
| RPC / ACP | Sequential native `select`/`input` dialogs; no tabs, notes, or previews |
| Non-interactive | Tool removed from the active set before the turn; a runtime backstop returns `no_ui` |

The tool is put back only if this plugin removed it. If you leave it out with `--tools` or settings, or another extension turns it off, it stays off.

In RPC mode the multi-select question becomes a text field. Enter numbers separated by commas (`1,3`), optionally followed by `; custom text`. Repeated numbers count once; an out-of-range number asks again; input that is not a number list is kept as free text. A dismissed dialog cancels the whole questionnaire.

If the TUI dialog itself fails, the tool shows a warning with the error and falls back to the RPC-style dialogs.

## External answers

Other extensions, a phone bridge, or a test harness can answer an open TUI questionnaire without synthesizing keystrokes.

Events:

| Event | Direction | Payload |
|---|---|---|
| `pi-ask-user:prompt` | outbound | `{ toolCallId, questions }` (preview content is represented by `hasPreview`) |
| `pi-ask-user:blocked` | outbound | `{ active, toolCallId }` around the wait |
| `pi-ask-user:answer` | inbound | `{ toolCallId, answers, globalNote?, cancel? }` |
| `pi-ask-user:answer-result` | outbound | `{ ok, code?, reason?, toolCallId }` |

Answer shape:

```ts
{
  toolCallId: "call-1",
  answers: [
    { questionIndex: 0, optionIndexes: [1] },                 // single-select
    { questionIndex: 1, text: "something else" },             // custom text
    { questionIndex: 2, optionIndexes: [0, 2], text: "and" }  // multi-select
  ],
  globalNote: "optional"
}
```

Rules:

- Every question must be answered exactly once; the answer is all-or-nothing.
- `not_found`: no open questionnaire for that `toolCallId`.
- `invalid_payload`: wrong shape or type.
- `invalid_answer`: an answer that does not fit the questions (partial, duplicate, out-of-range, single-select with two options, option plus custom text).
- `unsupported_host`: RPC/ACP hosts render the questions themselves.
- First answer wins; a later answer is refused.

```ts
pi.events.on("pi-ask-user:prompt", ({ toolCallId, questions }) => {
  // Forward to a phone/web UI, then emit an answer when it returns.
  pi.events.emit("pi-ask-user:answer", {
    toolCallId,
    answers: questions.map((question, index) => ({
      questionIndex: index,
      optionIndexes: [0],
    })),
  });
});
```

## Configuration

Both settings can be changed in the `/shizuku` panel (pi-shizuku-settings), which saves them to `~/.pi/agent/pi-ask-user.json`:

```json
{ "locale": "auto", "collapseKey": "ctrl+]" }
```

An environment variable overrides the file, and the panel shows that setting read-only:

```bash
PI_ASK_USER_LOCALE=zh            # UI locale: zh or en
PI_ASK_USER_COLLAPSE_KEY=alt+c  # collapse key (pi-tui key id); default ctrl+]
```

Without `PI_ASK_USER_LOCALE` or a `locale` other than `auto` in the file, `LC_ALL` / `LC_MESSAGES` / `LANG` decide, then the OS locale (Windows rarely sets `LANG`); non-Chinese locales use English. The model-facing prompt and result text stay English.

Set `PI_ASK_USER_COLLAPSE_KEY` when `Ctrl+]` is awkward on your keyboard layout. The collapse key is checked before everything else, so pick one the dialog does not already use: not `Ctrl+G`, and not a text-editing key of the inline field or editor (`Ctrl+A`, `Ctrl+E`, `Ctrl+W`, `Ctrl+U`, `Ctrl+K`, `Ctrl+Y`, …), or that binding stops working.

## Development

```bash
cd pi-ask-user
npm install
npm run check     # tsc --noEmit + vitest
```

The test suite covers argument repair, sanitization, validation, session/result derivation, the result envelope, RPC parsing, external answers, non-interactive reconciliation, metadata budget, the transcript row and its click, restoring a submitted result, and a TUI render/input smoke test including the read-only replay.

## Known limitations

- No persistence or restart recovery. The question lives in the open tool call.
- No image attachments; `preview` is markdown only.
- Previews render below the option list, not side-by-side.
- RPC hosts lose notes and previews because their dialog primitives do not expose them.
- The review tab allows partial submission; unanswered questions are named in the result.
- No goal-mode timeout or automatic recommended answer. Every ordinary question waits for a human.

---

本插件属于 Shizuku 系列 pi 插件（[pi-shizuku](https://github.com/AoShizuku/pi-shizuku)）：共用的左栏、设计语言与跨插件约定见总仓库。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。
