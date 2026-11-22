### 处理状态（2026-11-09）

- 1–3 已修：`prepareArguments` 只做结构修复（扁平问题、JSON 字符串、字符串布尔、缺失 header），不再丢弃、截断或改写值；超限和畸形输入原样交给 schema 报错。清洗移到执行阶段且不丢项，清洗后为空的由 `validate.ts` 报错。`validate.ts` 里的条数/长度分支仍保留，作为非工具调用路径的兜底。
- 4 已修：TUI 模块改为动态 import，交互式回合开始时在后台预热。
- 5 已修：单选题上 Space 不做任何事。
- 6 已修：折叠态 Esc 会先展开并弹确认；选"继续回答"回到原来的模式（包括编辑器和未保存文本）。
- 7 复核不成立：pi-tui 1.5.0 的 `matchesKey("\x1b[93;5u", "ctrl+]")` 返回 true，松开事件由 TUI 层过滤。仍新增 `PI_ASK_USER_COLLAPSE_KEY` 以适配不同键盘布局。
- 8 已修：删除 `clearAnswer` 和 6 个无引用的 i18n key。

### 实测发现的问题

**1. schema 校验层吃掉了一半的错误路径（真问题）**

`prepareArguments` 在 schema 校验**之前**运行，所以归一化把违规项悄悄修掉了，模型永远看不到自己错在哪：

```
5 个问题     → schema FAIL: must not have more than 4 items
1 个选项     → schema FAIL: must not have fewer than 2 items
缺 description → schema FAIL: must not have fewer than 1 characters
80 字符 label → schema FAIL: must not have more than 60 characters
```

而 `validate.ts` 里的 `too_many_questions` / `empty_options` / `invalid_params`(label 长度) 分支**永远走不到**——schema 先拦下，模型收到的是 pi 原生的 JSON Schema 报错，不是插件自己写的 "Error: at most 4 questions are allowed."

**2. 长 header 被静默截断而非报错**

`deriveHeader` 截到 16 字符加 `…`，schema 的 `maxLength: 16` 也就永远不触发。用户看到的是被悄悄改过的 header，模型不知道自己写了 40 字符。

**3. 畸形问题被静默丢弃**

```js
questions: [{question:"Good?",...}, {question:12345, options:[]}]
→ prepared.questions.length = 1，validation: ok
```

第二个问题整个消失，无任何提示。上游 `normalize-params.ts` 只解码 JSON 字符串，不做这种过滤。

**4. 启动成本**：`pi-coding-agent` 导入 406ms + `pi-tui` 57ms + `questionnaire` 49ms。上游用动态 import 懒加载 TUI 渲染图并在启动 2s 后预热，本插件是静态导入 `src/index.ts` 顶层直接引 `tui/questionnaire.js`。

**5. Space 键在单选题上会直接提交答案**（实测 `settled? true`）。上游 Space 只在多选题上切换复选框。单选题上误触空格就等于提交了。

**6. 折叠态下 Esc 立即取消**，跳过了确认对话框。展开态有确认，折叠态没有。

**7. `Ctrl+]` 在 Kitty 协议下失效**：实测 `matchesKey("\x1b[93;5u", "ctrl+]")` = false（legacy `\x1d` 和 kitty `;` 键正常）。上游把它做成了可配置项 `collapseKey`，正是为了绕开某些键盘布局。

**8. 死代码**：`session.ts` 的 `clearAnswer` 未被任何地方调用；`i18n.ts` 里 `notes.placeholder` / `custom.placeholder` / `answer.custom` / `sentinel.other` / `sentinel.submit` / `ask.unanswered` 六个 key 无引用。