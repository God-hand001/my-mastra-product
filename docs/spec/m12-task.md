# M12 执行过程可观测化 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `docs/spec/m12-t0-notes.md` | T0 抓流验证结论记录 |
| 修改 | `package.json`（根） | 显式声明 `diff` 依赖 |
| 新建 | `src/mastra/services/content-diff.ts` | diff 纯函数 |
| 修改 | `src/mastra/tools/project-tools.ts` | 写入工具接入 diff |
| 新建 | `app/src/lib/toolMeta.ts` | 工具元信息映射表（文案/图标/摘要，全前端唯一） |
| 重写 | `app/src/components/ToolCallCard.tsx` | 工具卡片 |
| 新建 | `app/src/components/ReasoningBlock.tsx` | 深度思考区块 |
| 修改 | `app/src/components/AssistantSteps.tsx` | StepsBody/StepsFold/阶段推导 |
| 修改 | `app/src/components/ChatThread.tsx` | 进度条阶段文案 |
| 修改 | `app/src/lib/messages.ts` | 历史转换微调（条件任务） |
| 修改 | `app/src/styles/app.css` | 思考块/步骤体/diff 样式 |

## 执行者约定

- **[主]** 由主 agent 执行：T0、T1、T10、T11 及全部运行时验证（沙箱账户读不到 `.env`、回环请求被拦，codex 无法起 dev server / 发真实请求）
- **[codex]** 由 codex 执行的编码任务：T2-T9，**严格串行**派发（单 codex-home，禁止并发 spawn；同文件任务 `&&` 串联）
- codex 任务完成后，**编译与行为验证由主 agent 复核**，codex 自报的验证结果不作数
- codex 指令书统一附安全红线：只改任务书列出的文件；不执行网络下载；不删除/重命名既有文件；中文内容写入文件禁用 PowerShell `Set-Content`（用 Node `fs.writeFileSync` UTF-8）

## T0: 抓流验证 reasoning 数据源 [主]

**文件：** `docs/spec/m12-t0-notes.md`（新建）
**依赖：** 无
**步骤：**
1. 确认 `.env` 中模型密钥可用，启动 Mastra dev server（后台，`< /dev/null`，避开 codex 并发窗口）
2. 用 curl 向 `/chat/agent` 发一条会触发工具调用的真实请求，原始 SSE 输出重定向到临时文件
3. 在输出中检索 reasoning 相关 part（`reasoning-start`/`reasoning-delta`/`"type":"reasoning"` 等）；同时记录 tool-call part 的字段形态（`state` 值、input/output 字段名），与 `messages.ts` 历史转换的假设比对
4. 换 `deepseek/deepseek-v4-pro` 重复一次（若 flash 无 reasoning，pro 可能有）
5. 结论写入 `m12-t0-notes.md`：每个模型有无 reasoning、part 字段形态、对 `messages.ts` 的影响

**验证：** notes 文件含两模型的实测证据（原始流片段）与明确结论

## T1: 声明 diff 依赖 [主]

**文件：** 根 `package.json`
**依赖：** 无
**步骤：**
1. 根 `package.json` dependencies 加入 `"diff": "^8.0.3"`（版本对齐 lock 中已有条目）
2. `npm install`（仅此步联网，主 agent 执行）
3. `npm ls diff` 确认落在根 node_modules

**验证：** `npm ls diff` 输出 `diff@8.x`；`node -e "require('diff').diffLines"` 不抛错

## T2: diff 纯函数 [codex]

**文件：** `src/mastra/services/content-diff.ts`（新建）
**依赖：** T1
**步骤：**
1. 导出类型 `DiffPayload`（结构见 plan：`isNew/hunks/added/removed/truncated`，hunk 为 `{type: 'add'|'del'|'ctx', text}`）
2. 导出 `computeContentDiff(oldStr: string | null, newStr: string, opts?): DiffPayload`
   - `oldStr === null` → 全部行 add、`isNew: true`
   - 任一输入超 60,000 字符 → `hunks: []`、`truncated: true`、added/removed 仍统计（按行数差粗算或置 0，选一并在注释写明）
   - 内部用 `diff.diffLines`，把输出折叠为逐行 hunks（上下文行保留，便于阅读）
   - hunks 超 400 行截断至 400，`truncated: true`
3. 文件头中文注释说明用途与截断规则

**验证（主 agent 复核）：** 临时 mjs 脚本构造 4 组输入（新建/修改/超长截断/同内容零 diff）断言输出；`npx tsc --noEmit` 通过

## T3: 写入工具接入 diff [codex]

**文件：** `src/mastra/tools/project-tools.ts`
**依赖：** T2
**步骤：**
1. `projectWriteFileTool` 的 `outputSchema` 增加可选 `diff` 字段（结构同 `DiffPayload`）
2. `execute` 写入前：`readFile` 捕获 ENOENT 视为 `null`（新建）；调用 `computeContentDiff`；把 `diff` 并入现有返回 `{path, bytes}`
3. 读旧内容失败（非 ENOENT）不阻断写入：diff 置 `truncated: true`、`hunks: []`，注释写明降级原因
4. 不改动同文件内其它工具

**验证（主 agent 复核）：** `npx tsc --noEmit` 通过；起 dev server 后真实调用 `project_write_file`（新建 + 覆盖各一次），观察消息流中 result 含 `diff` 字段

## T4: 工具元信息映射表 [codex]

**文件：** `app/src/lib/toolMeta.ts`（新建）
**依赖：** 无（与 T2/T3 可并行，但 codex 串行，故排在 T3 后）
**步骤：**
1. 从 `ToolCallCard.tsx` 迁移并扩展 `LABEL_RULES` 为四元组 `{pattern, running, done, icon, summary?}`（plan 列出的全部工具，含补齐 `html_to_docx`/`html_to_pptx`/`xlsx_build`/`request_sandbox_elevation`/`skill`）
2. 迁移 `stripToolPrefix`；导出 `toolPhaseLabel(toolName)`（保持现签名，AssistantSteps 正在引用）与新增 `toolDoneLabel(toolName)`、`toolIcon(toolName)`、`toolSummary(args)`（提取顺序 filePath→command→query/keyword→url→name/skill→首个字符串值；截断 60 字符；无匹配返回 `''`）
3. 兜底：未命中规则 running=「正在处理」、done=「已完成」、icon=「🛠」

**验证（主 agent 复核）：** 临时 mjs 断言 `toolPhaseLabel('mastra_workspace_execute_command')==='正在执行命令'`、`toolSummary({filePath:'src/a.html'})==='src/a.html'`；`npx tsc --noEmit` 通过（此时 ToolCallCard 尚未改，旧引用不破坏——`toolPhaseLabel` 签名未变）

## T5: 工具卡片重写 [codex]

**文件：** `app/src/components/ToolCallCard.tsx`
**依赖：** T4
**步骤：**
1. props 保持 `ToolCallMessagePartProps` 兼容；状态判定优先 `status?.type`（running/incomplete），回退现有 `result === undefined && isError !== true`（历史消息无 status）
2. 摘要行：`toolIcon` + `running/done` 文案 + `toolSummary(args)`（灰色小字）+ 状态词；失败时追加错误首行（字符串 result 取首行、对象取 `error` 字段，截 80 字符）
3. 展开区：`result?.diff` 存在时渲染 diff（add/del/ctx 行 + `+N -M` 统计 + 截断标记），行前缀保留 `+`/`-`/空格；diff 缺失时按旧渲染参数/结果（pretty JSON、800 字符截断）
4. 状态样式类沿用 `is-running`/`is-error`；纯文本节点渲染，不引入 `dangerouslySetInnerHTML`
5. 删除本文件内的旧 `LABEL_RULES`/`toolPhaseLabel`（已迁至 toolMeta），确认无其它文件从本文件导入（AssistantSteps 引用改由 T7 处理，本任务先保留一行 re-export 过渡以免中间态编译失败：`export { toolPhaseLabel } from '../lib/toolMeta'`）

**验证（主 agent 复核）：** `cd app && npx tsc --noEmit` 通过

## T6: 深度思考区块 [codex]

**文件：** `app/src/components/ReasoningBlock.tsx`（新建）
**依赖：** 无编译依赖（供 T7 使用）
**步骤：**
1. props 用 `ReasoningMessagePartProps`（`@assistant-ui/react` 导出），取 `text`、`status`
2. `text` 为空且 `status?.type !== 'running'` → 返回 `null`（F9）
3. `<details>`：`status?.type === 'running'` 时默认 open（`key` 含 running 态以重置展开）、标题「深度思考中…」+ spinner；结束标题「已深度思考 · N 秒」
4. 计时：首次观测到 running 时记 `startMs`（`useRef`），结束时算差值；历史消息无 running 观测则只显示「已深度思考」
5. 正文按纯文本流式渲染（`white-space: pre-wrap`），不走 Markdown

**验证（主 agent 复核）：** `cd app && npx tsc --noEmit` 通过

## T7: 步骤体与受控折叠 [codex]

**文件：** `app/src/components/AssistantSteps.tsx`
**依赖：** T5、T6
**步骤：**
1. `PART_COMPONENTS` 增加 `Reasoning: ReasoningBlock`
2. 抽出 `StepsBody({answerStart})`：渲染 parts `0..answerStart`（现 CollapsedSteps 内部逻辑）
3. `CollapsedSteps` 改 `StepsFold({answerStart, isStreaming, label})`：受控 `<details>`，`open = isStreaming || userExpanded`；`isStreaming` 边沿 false 时收起；用户 toggle 写 `userExpanded`；label 逻辑沿用（等待你的授权）
4. `computePhaseLabel` 按 plan 优先级表重写（工具 running → reasoning 流式 → 末尾 text 流式 → 有 parts → 无 parts）；导出供 ChatThread 使用
5. AssistantMessage 的调用方改造在 ChatThread 一侧（T8），本文件导出 `StepsFold`/`StepsBody`/`computePhaseLabel` 即可；保持 `useAnswerBoundary`/`PhaseLine`/`AnswerParts` 导出不变

**验证（主 agent 复核）：** `cd app && npx tsc --noEmit` 通过（此时 ChatThread 仍用旧 CollapsedSteps 会失败——若如此，T7 与 T8 合并验证，或在 T7 中同步改 AssistantMessage 的 JSX。执行时按编译结果决定，倾向 T7 顺带改 AssistantMessage，T8 只改进度条）

## T8: 进度条阶段文案与消息区接入 [codex]

**文件：** `app/src/components/ChatThread.tsx`
**依赖：** T7
**步骤：**
1. AssistantMessage 流式分支改渲染 `StepsFold(isStreaming)` + `AnswerParts`；非流式渲染 `StepsFold(isStreaming=false)` + `AnswerParts`；纯对话（answerStart===0 且前段无 reasoning/tool part）不渲染 StepsFold
2. 进度条：`chat-progress-label` 改为订阅最后一条 assistant 的 parts 调 `computePhaseLabel`；`usePolledApprovals` 非空时覆盖为「等待你的授权…」；秒数显示不变
3. 不动审批弹窗、计时、重新生成逻辑

**验证（主 agent 复核）：** `cd app && npm run build` 通过

## T9: 样式 [codex]

**文件：** `app/src/styles/app.css`
**依赖：** T5-T8
**步骤：**
1. 思考区块：浅底（`#faf9f6` 系）、小字号、summary 行样式、spinner 复用 `.tool-card-spinner`
2. 步骤体时间线：StepsBody 内各元素左缩进与间距
3. diff 行：`.diff-line-add` 浅绿底/`.diff-line-del` 浅红底/`.diff-line-ctx` 默认，等宽字体，`+`/`-` 前缀（颜色非唯一区分手段，N6）
4. 沿用现有色板与圆角，不引入新色值（plan N5）

**验证（主 agent 复核）：** `npm run build` 通过；页面目视

## T10: 历史转换微调（条件任务）[codex]

**文件：** `app/src/lib/messages.ts`
**依赖：** T0 结论 + T7
**步骤：**
1. 若 T0 发现流式 part 形态与历史转换输出不一致（如 dynamic-tool 缺 `state: 'input-streaming'` 分支、reasoning 字段名差异），按实测补齐转换
2. T0 结论为「无需改动」则本任务取消，在 notes 标记

**验证（主 agent 复核）：** `npm run build` 通过；刷新页面回看历史多步回复，过程完整呈现

## T11: 端到端验收 [主]

**文件：** 无（对照 `m12-checklist.md`）
**依赖：** T1-T10 全部
**步骤：**
1. dev server 启动（避开 codex 窗口）
2. 逐条执行 checklist：闲聊（无折叠行）、多步任务（流式过程可见→自动收起→展开回看）、文件新建/覆盖（diff）、失败工具（错误摘要）、触发沙箱授权（等待你的授权）、连接器工具（兜底文案）、刷新回看、重新生成
3. 结果记入验收报告 `docs/spec/m12-验收报告.md`

**验证：** checklist 逐项有证据

## 执行顺序

```
T0[主] ────────────────┐(结论供 T10)
T1[主] → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11[主]
        └────────── codex 串行段 ──────────┘
```
