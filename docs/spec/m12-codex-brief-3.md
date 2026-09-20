# M12 Codex 指令书 · 批 3（思考块 + 步骤体 + 进度条 + 样式）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序执行，不做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；禁止运行 dev server；禁止调用任何本地/远程服务
3. 禁止用 PowerShell `Set-Content` 写含中文的文件
4. 每个任务完成后跑：`cd app && npx tsc --noEmit`（必须通过才进入下一任务）

## 背景

批 1（后端 diff）、批 2（`app/src/lib/toolMeta.ts` + `ToolCallCard.tsx` 重写）已完成并复核。实测结论：deepseek 模型不输出 reasoning，但组件按完整契约实现。

现有结构（`app/src/components/AssistantSteps.tsx`）：
- `computeAnswerStart(parts)`：结尾连续 text part 的起始索引，之前的都是"中间步骤"
- `PhaseLine`：流式中一行 spinner+文字
- `CollapsedSteps`：完成后 `<details>` 折叠中间步骤
- `AnswerParts`：渲染最终答案部分
- `PART_COMPONENTS`：`{Text: AssistantText, tools: {Fallback: ToolCallCard}}`
- `ChatThread.tsx` 的 `AssistantMessage` 用 isStreaming 分支：流式渲染 PhaseLine+AnswerParts，否则 CollapsedSteps+AnswerParts；输入框上方 `chat-progress-label` 硬编码「处理中...」

本批目标：过程步骤体在流式期间内联展开、结束后自动收起（用户手动展开优先）；新增 Reasoning 思考区块；输入框上方进度条文案按阶段动态变化。

## T6: 新建 `app/src/components/ReasoningBlock.tsx`

props 用 `ReasoningMessagePartProps`（从 `@assistant-ui/react` 导入类型），取 `text`、`status`：

1. `text` 为空字符串且 `status?.type !== 'running'` → 返回 `null`（模型无推理时不出现空区块）
2. `<details className="reasoning-block">`：
   - `status?.type === 'running'`：默认展开（用 `open` 属性），标题「深度思考中…」+ 复用类名 `tool-card-spinner` 的旋转指示
   - 结束后：标题「已深度思考 · N 秒」（N = 本组件观测的运行时长）；默认收起
3. 计时：`useRef` 存首次观测到 running 的时间戳；`status` 变为非 running 时算差值存 `useState`。历史消息（无 status）只显示「已深度思考」，不显示耗时
4. 正文 `<div className="reasoning-body">{text}</div>` 纯文本渲染（CSS 里 pre-wrap），不走 Markdown
5. 中文注释写明：实测 deepseek 不吐 reasoning，本组件为完整契约实现；历史消息的 reasoning part 无 status 字段

## T7: 改造 `app/src/components/AssistantSteps.tsx`

1. `PART_COMPONENTS` 增加 `Reasoning: ReasoningBlock`
2. 新增 `StepsBody({ answerStart }: { answerStart: number })`：渲染 parts `0..answerStart`（把现 CollapsedSteps 内部的 PartByIndex 循环提出来，组件配置同现有）
3. `CollapsedSteps` 改名 `StepsFold`，签名 `{ answerStart, isStreaming, label }`：
   - 受控 `<details>`：`open = isStreaming || userExpanded`
   - `isStreaming` 从 true 变 false 时 `userExpanded` 重置为 false（自动收起）；用 useEffect 监听
   - 用户 onToggle 时若非流式期间，写 `userExpanded`（手动意图优先）
   - label 缺省「任务已完成」，调用方可覆盖（等待你的授权）
4. `computePhaseLabel(parts)` 按优先级重写：
   1. 末尾向前找第一个 `tool-call` 且无 result 的 part → `toolPhaseLabel(toolName) + '…'`
   2. 有 `reasoning` part 且是其最新 part → 「正在思考…」
   3. 末尾 `text` part 存在 → 「正在生成回复…」
   4. 有 parts 但都不满足 → 「正在思考…」
   5. 空 parts → 「正在读你的问题…」
   （维持导出，PhaseLine 继续用）
5. 保持 `useAnswerBoundary`、`AnswerParts` 导出与行为不变；删除旧 `CollapsedSteps`（ChatThread 同批更新，见 T8）
6. `PhaseLine` 保留不动（向后兼容，虽然 T8 后消息区可能不再用它）

## T8: 改造 `app/src/components/ChatThread.tsx`

1. `AssistantMessage`：
   - `hasProcessSteps = answerStart > 0 || parts 中存在 reasoning 或 tool-call 类型`（新计算，可用 useAuiState 派生；注意历史消息与流式都要正确）
   - 流式分支：`hasProcessSteps && <StepsFold answerStart isStreaming label />` + `<AnswerParts />`
   - 非流式分支：`hasProcessSteps && <StepsFold answerStart={answerStart} isStreaming={false} label={waitingApproval ? '等待你的授权' : undefined} />` + `<AnswerParts />`
   - 纯对话（无步骤）不渲染 StepsFold；`answerStart === 0 && waitingApproval` 的独立提示保留
   - PhaseLine 不再使用则从 import 中移除（组件保留在 AssistantSteps 里）
2. 进度条（`chat-progress-label`）：
   - 从 `runtime.thread.getState().messages` 取最后一条 assistant 的 parts，调 `computePhaseLabel`（从 AssistantSteps 导入）
   - `usePolledApprovals(threadId)` 非空时覆盖为「等待你的授权…」
   - 秒数 `chat-progress-time` 显示不变；订阅方式可用现有的 200ms interval 顺带更新（避免每帧 setState），或独立 state + interval，注意性能
3. 不动审批弹窗、计时 store、重新生成逻辑

**验证**：`cd app && npx tsc --noEmit`；再做 `cd app && npm run build` 确认 vite 构建过。

## T9: 样式 `app/src/styles/app.css`

文件末尾新增（不改动既有规则；引用类名若与现有一致则复用）：

1. `.reasoning-block`：边框 1px `#e5e1d9`、圆角 10px、底色 `#f6f4ef`、margin 8px 0、padding 8px 12px、font-size 13px；summary 行 flex + cursor pointer + list-style none（含 webkit-marker 清除，参考 `.tool-call-card summary` 写法）；`.reasoning-body`：`white-space: pre-wrap`、`max-height: 260px`、`overflow-y: auto`、颜色 `#6b665c`、font-size 12.5px
2. `.msg-steps`（StepsFold 沿用此类名则不动；若你新建类名则新增）——注意 T7 里 StepsFold 建议保留 `msg-steps` 类名以复用现有样式，仅新增流式展开时的内联形态间距
3. `.tool-call-hint`：浅色 `#8a857a`、font-size 12px、`flex: 1`、`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap`、`min-width: 0`
4. `.tool-call-errline`：作为 summary 内的 span，需要 `flex-basis: 100%`（换行独占一行）、颜色 `#c0392b`、font-size 12px
5. `.tool-call-diff` 系列：`.tool-call-diff-stats`（flex gap 8px、font-size 12px；`.diff-stat-add` 绿 `#2e7d32`、`.diff-stat-del` 红 `#c0392b`、`.diff-stat-truncated` 灰）；`.tool-call-diff-pre`：等宽 Consolas/Menlo、font-size 12px、`max-height: 300px`、`overflow: auto`、背景 `#fff`、边框 `#e5e1d9`、圆角 6px、padding 8px；`.diff-line`（flex）、`.diff-line-add`（底 `#e8f5e9`）、`.diff-line-del`（底 `#fdecea`、文字可加删除线可选）、`.diff-line-ctx`（无底色）、`.diff-line-prefix`（等宽、opacity 0.7、`width: 1em`、`flex-shrink: 0`）
6. `.tool-call-diff-empty`：灰色小字
7. 所有颜色来自现有色板或上述明确列出值；不引入新字体

## 汇报格式

完成后回复：改动/新建文件列表、每个任务 tsc/build 结果原文、T8 中 AssistantMessage 最终 JSX 结构摘要、遗留问题。
