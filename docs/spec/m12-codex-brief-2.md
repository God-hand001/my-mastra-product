# M12 Codex 指令书 · 批 2（工具映射表 + 工具卡片）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序执行，不做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；禁止运行 dev server；禁止调用任何本地/远程服务
3. 禁止用 PowerShell `Set-Content` 写含中文的文件（用你的文件编辑工具或 Node `fs.writeFileSync(..., 'utf8')`）
4. 每个任务完成后跑：`cd app && npx tsc --noEmit`（必须通过才进入下一任务）

## 背景

M12 执行过程可观测化，批 1（后端 diff）已完成：`project_write_file` 的结果现在带可选 `diff` 字段（`{isNew, hunks: [{type:'add'|'del'|'ctx', text}], added, removed, truncated}`）。

本批做前端工具层：把工具名→中文文案的映射规则升级为全前端唯一的元信息表（文案/图标/关键参数摘要），并重写工具卡片组件（摘要行 + 状态 + diff 渲染 + 失败摘要）。

## T4: 新建 `app/src/lib/toolMeta.ts`

1. 阅读 `app/src/components/ToolCallCard.tsx` 现有 `LABEL_RULES` 与 `stripToolPrefix`、`toolPhaseLabel`（保持行为兼容）
2. 新建 `app/src/lib/toolMeta.ts`，导出：
   ```ts
   interface ToolMetaRule {
     pattern: RegExp;
     running: string;   // 进行时文案
     done: string;      // 完成时文案
     icon: string;      // emoji
     summary?: (args: Record<string, unknown>) => string;  // 关键参数摘要
   }
   export function stripToolPrefix(toolName: string): string;   // 行为同现有
   export function toolPhaseLabel(toolName: string): string;    // 行为同现有（进行时文案，不带省略号）
   export function toolDoneLabel(toolName: string): string;     // 完成时文案；未命中规则→'已完成'
   export function toolIcon(toolName: string): string;          // 未命中→'🛠'
   export function toolSummary(args: Record<string, unknown>): string;  // 未命中或无字符串值→''
   ```
3. 规则表在现有 13 条基础上补齐：`html_to_docx`（正在生成 Word/已生成 Word 文档 📄）、`html_to_pptx`（正在生成 PPT/已生成 PPT 文档 📊）、`xlsx_build`（正在生成表格/已生成表格 📈）、`request_sandbox_elevation`（正在请求沙箱提权/已提交提权请求 🔐）、`skill`（正在读取技能/已读取技能 🧩）。每个工具的 icon 自行选择贴切 emoji 并加中文注释。
4. `toolSummary` 提取优先级：`filePath` → `command` → `query`/`keyword` → `url` → `name`/`skill` → 首个字符串类型值；超 60 字符截断加 `…`；无匹配返回 `''`。
5. 中文注释写明：这是全前端唯一映射源，ToolCallCard 与状态行共用。

## T5: 重写 `app/src/components/ToolCallCard.tsx`

保留文件路径与组件名 `ToolCallCard`，内部重写：

1. **状态判定**：优先 `props.status?.type`（`'running'` → 进行中；`'incomplete'` → 失败）；status 缺失（历史消息）回退现有判定（`isError === true` 或 `result === undefined`）。注意 props 里 `status` 可能不存在，类型上用可选访问。
2. **摘要行（未展开可见）**：
   - `toolIcon(toolName)` + 动作文案（进行中用 `toolPhaseLabel`、完成/失败用 `toolDoneLabel`）
   - `toolSummary(args)` 非空时显示为浅色小字（新类名 `tool-call-hint`）
   - 状态词（右对齐）：运行中… / 已完成 / 失败
   - **失败时**摘要行下追加一行错误摘要（新类名 `tool-call-errline`）：result 为字符串取首个非空行、为对象取其 `error` 字段（字符串化）；超 80 字符截断
3. **展开区**：
   - `result` 为对象且含 `diff` 字段（形状见背景）时，**优先渲染 diff**：顶部一行 `+N -M`（N=added 绿色、M=removed 红色；truncated 时追加「(已截断)」）；hunks 逐行渲染（新类名 `diff-line diff-line-add/del/ctx`），行首前缀字符：add=`+`、del=`-`、ctx=空格——前缀与颜色同时存在（无障碍）。diff 空且 truncated 显示「差异过大，已省略」
   - 无 diff 时按现状渲染：参数区（pretty JSON，800 字符截断）+ 结果区（同规则）
   - 有 diff 时参数区仍显示（filePath 有用），结果区省略（diff 已是结果的可读形态）
4. **渲染安全**：所有内容以 React 文本节点渲染；禁止 `dangerouslySetInnerHTML`
5. **迁移**：删除本文件内旧 `LABEL_RULES`/`stripToolPrefix`/`toolPhaseLabel` 实现；文件顶部保留一行过渡导出 `export { toolPhaseLabel } from '../lib/toolMeta';`（AssistantSteps.tsx 现在还从本文件导入它，批 3 会改；不要动 AssistantSteps.tsx）
6. 保持 `toolPhaseLabel` 具名导出的路径兼容即可；组件 props 类型不变（`ToolCallMessagePartProps`）

**验证**：`cd app && npx tsc --noEmit` 通过。写临时文件 `app/tmp-t5-check.mjs`（验证完删除）用 node 断言 `toolPhaseLabel('mastra_workspace_execute_command')==='正在执行命令'`、`toolDoneLabel('html_to_docx')==='已生成 Word 文档'`、`toolSummary({filePath:'src/a.html'})==='src/a.html'`、`toolSummary({command:'npm i'})==='npm i'`、`toolSummary({a:1})===''`。纯 mjs import ts 会失败——改为把断言写在临时 `app/tmp-t5-check.ts` 用 `cd app && npx tsc --noEmit` 编译验证类型，逻辑断言以走查说明代替（在最终回复中给出每个断言的推演）。

## 汇报格式

完成后回复：改动/新建文件列表、每个 tsc 的结果、断言推演、遗留问题（如有）。
