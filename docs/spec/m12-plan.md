# M12 执行过程可观测化 Plan

## 架构概览

改动分两侧：

**后端（1 处）**：`project_write_file` 工具在写入前读取原文件内容，用 `diff` 包（已在根 node_modules，需显式声明依赖）计算行级差异，把结构化的 diff 数据（变更行序列 + 增删统计 + 截断标记）随工具结果一并返回。差异在前端如何呈现与后端无关。

**前端（主体）**：渲染层从「一行 PhaseLine + 折叠块」改造为「过程步骤体内联 + 自动收起的受控折叠容器」：

- 过程步骤体：assistant-ui 的 part 流按索引渲染，`Reasoning` part 渲染为新的思考区块组件，`tool-call` part 渲染为重做的工具卡组件，中间的 `text` part 渲染为叙述文字（沿用现有 AssistantText）
- 折叠容器：`<details>` 的 `open` 改为受控——流式期间强制展开，流结束后自动收起，用户手动展开的意图优先
- 状态行：输入框上方的进度条文案改为从线程状态推导当前阶段（思考/调用工具/执行命令/生成回复/等待授权），推导函数与消息内 PhaseLine 共用一个数据源与映射表
- 工具卡：状态判断改用 part 的 `status`（running/complete/incomplete）与 `isError`，新增图标、关键参数摘要、diff 渲染、失败原因摘要

历史消息回放不需要新链路：`messages.ts` 已把存储中的 `reasoning` / `tool-invocation` 转成 UIMessage part，历史消息走同一套渲染组件（缺 diff 字段时卡片降级，见 N1）。

## 核心数据结构

### 工具结果的 diff 载荷（后端产出，前端消费）

`project_write_file` 的输出 schema 新增可选字段：

```ts
diff?: {
  isNew: boolean;          // true=新建文件（写入前不存在）
  hunks: Array<{           // 行级变更序列（上下文行 + 增删行，按原顺序）
    type: 'add' | 'del' | 'ctx';
    text: string;          // 该行内容（不含换行符）
  }>;
  added: number;           // 新增行数
  removed: number;         // 删除行数
  truncated: boolean;      // 内容或行数超上限被截断
};
```

截断规则（F20）：写入前内容或新内容任一超过 60,000 字符时不计算 diff（`hunks: []`，`truncated: true`）；计算出的 hunks 超过 400 行时截断到 400 行并置 `truncated: true`。

### 工具元信息映射（前端）

现有的 `LABEL_RULES` 扩展为四元组规则表，全前端唯一一份：

```ts
Array<{
  pattern: RegExp;        // 匹配去前缀后的工具名
  running: string;        // 进行时文案，如「正在读取文件」
  done: string;           // 完成时文案，如「已读取文件」
  icon: string;           // emoji 图标
  summary?: (args) => string;  // 关键参数摘要提取（F12）
}>
```

补充缺失的工具规则：`html_to_docx`、`html_to_pptx`、`xlsx_build`、`request_sandbox_elevation`、`skill`、`request_sandbox_elevation`；`summary` 提取顺序：`filePath` → `command` → `query`/`keyword` → `url` → `name`/`skill` → 首个字符串值的键；均截断至 60 字符。未命中规则的工具显示兜底文案（F18）。

### 阶段推导（状态行与消息内 PhaseLine 共用）

输入为（最后一条 assistant 的 parts，是否存在待决审批），输出中文阶段文案：

| 优先级 | 条件 | 文案 |
|---|---|---|
| 1 | 存在待决审批 | 等待你的授权… |
| 2 | 末尾有未拿到 result 的 tool-call | 该工具的 running 文案 + … |
| 3 | reasoning part 处于流式中 | 正在思考… |
| 4 | 末尾 text part 流式中（尚未结束） | 正在生成回复… |
| 5 | 有 parts 但均不在流式中 | 正在思考… |
| 6 | 无 parts | 正在读你的问题… |

注：审批等待（优先级 1）数据源用 ChatThread 已有的待决审批轮询。

## 模块设计

### 后端：project-tools.ts（修改）

**职责：** `projectWriteFileTool.execute` 写入前读原文件（不存在 → `isNew`），调用 diff 计算模块产出载荷，随既有 `{path, bytes}` 返回。
**对外接口：** 不变（工具 id 与输入 schema 不动，输出 schema 加可选 `diff`）。
**依赖：** 新建 `src/mastra/services/content-diff.ts`（纯函数：`(oldStr, newStr, caps) => DiffPayload`，内部用 `diff` 包的 `diffLines`）。

### 前端：ReasoningBlock.tsx（新建）

**职责：** 思考区块（F6-F9）。props 为 assistant-ui 的 `ReasoningMessagePartProps`（`text` + `status`）。
**行为：** `<details>`；`status.type === 'running'` 时标题「深度思考中…」且默认展开、文字随流追加；结束后标题「已深度思考 · N 秒」（N 为本组件观测到的运行时长，刷新后历史消息无时长数据则只显示「已深度思考」）并收起（除非用户展开）；`text` 为空且不在流式中时不渲染（F9）。
**依赖：** 无。

### 前端：ToolCallCard.tsx（重写）

**职责：** 工具卡（F10-F15、F18）。props 为 `ToolCallMessagePartProps`。
**行为：**
- 状态判定改用 `status`：`running` → 进行中（动态指示）；`incomplete` 或 `isError` → 失败；否则已完成。历史消息无 status 时回退现有判定（result 有无）
- 摘要行：图标 + 中文文案（映射表）+ 关键参数摘要 + 状态文字；失败时摘要行追加错误信息首行
- 展开区：参数（pretty JSON，截断 800 字符）；diff 存在时优先渲染 diff（红/绿行 + 增删统计，纯文本行渲染，React 自动转义满足 N7）；结果（pretty JSON 或纯文本，截断）
- 失败摘要（F15）：`result` 为字符串取首行，为对象取 `error` 字段，均截断 80 字符
**依赖：** 工具元信息映射表。

### 前端：AssistantSteps.tsx（修改）

**职责：** 过程步骤体与折叠容器（F1-F5）、消息内 PhaseLine（F16 在消息区的对应物）。
**改动：**
- `PART_COMPONENTS` 增加 `Reasoning: ReasoningBlock`
- 新增 `StepsBody`：把现在 `CollapsedSteps` 内部的「parts 0..answerStart 逐个渲染���提出来，供折叠与内联两种形态共用
- `CollapsedSteps` → `StepsFold`：受控 `<details>`，`open = isStreaming || userExpanded`；`isStreaming` 从 true 变 false 时收起；用户在非流式期间的 toggle 记入 `userExpanded`（F2/F3）
- `AssistantMessage`（在 ChatThread.tsx）流式分支从「PhaseLine + AnswerParts」改为「StepsFold（内含 StepsBody）+ AnswerParts」，纯对话（answerStart===0 且无 reasoning/tool parts）不渲染 StepsFold（F3）
- `computePhaseLabel` 按上表重写（优先级 2-6；优先级 1 由调用方传入覆盖）
**依赖：** ReasoningBlock、ToolCallCard、映射表。

### 前端：ChatThread.tsx（修改）

**职责：** 输入框上方进度条的阶段文案（F16/F17）。
**改动：** `chat-progress-label` 从硬编码「处理中...」改为：订阅 runtime 取最后一条 assistant 的 parts 调共用推导函数；待决审批存在时（已有 `usePolledApprovals` 数据）覆盖为「等待你的授权…」。秒数照旧。
**依赖：** AssistantSteps 导出的推导函数与映射表。

### 前端：messages.ts（微调）

**职责：** 历史回放（F5/N1）。
**改动：** 预计无需改动（reasoning/tool-invocation 已转换）。若 T0 验证发现流式 part 形态与历史形态不一致（如 dynamic-tool 的 `input-streaming` 状态缺失），在此补齐。

### 样式：app.css（修改）

新增：思考区块（浅色底、小字号、等宽可选）、步骤体的时间线间距、diff 行（add 浅绿底/del 浅红底/ctx 灰、等宽字体、行内 +/- 前缀同时保留以不依赖颜色，满足 N6）、状态指示动画沿用现有 spinner。复用现有 token：边框 `#e5e1d9`、底色 `#faf9f6`、错误红 `#fdcdc5`/`#ef4444`、运行绿 `#9fdcb6`。

## 模块交互

```
用户发送任务
  → Mastra chatRoute 流式返回 UIMessage parts
  → assistant-ui runtime 维护 parts 数组
  → AssistantMessage（ChatThread.tsx）
      ├─ 流式中：StepsFold(open) → StepsBody → 逐 part 渲染
      │     ├─ reasoning part → ReasoningBlock（流式追加）
      │     ├─ text part → AssistantText（叙述文字）
      │     └─ tool-call part → ToolCallCard（status=running）
      └─ 流结束：StepsFold 收起（label=任务已完成/等待你的授权）→ 展开回看同上
  → ChatThread 进度条：同一 parts + 待决审批 → 阶段文案

project_write_file 执行
  → 读原文件 → content-diff 计算 → 结果 {path, bytes, diff}
  → 落库进 tool-invocation result
  → ToolCallCard 渲染 result.diff（历史消息同样可渲染）
```

## 文件组织

```
my-mastra-product/
├── package.json                          → 显式声明 diff 依赖（改）
├── src/mastra/
│   ├── services/content-diff.ts          → diff 纯函数（新建）
│   └── tools/project-tools.ts            → write 工具接入 diff（改）
├── app/
│   ├── src/components/
│   │   ├── AssistantSteps.tsx            → StepsFold/StepsBody/阶段推导（改）
│   │   ├── ChatThread.tsx                → 进度条阶段文案（改）
│   │   ├── ToolCallCard.tsx              → 重写（改）
│   │   └── ReasoningBlock.tsx            → 思考区块（新建）
│   ├── src/lib/messages.ts               → 历史转换（按需微调）
│   └── src/styles/app.css                → 新样式（改）
└── docs/spec/m12-{spec,plan,task,checklist}.md
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| diff 在哪算 | **后端算好结构化 hunks**，前端只渲染 | 结果落库，历史回放/刷新后 diff 仍在（AC10 + N1）；前端零新依赖；`diff` 包在根依赖树已存在，加显式声明即可 |
| 前端折叠容器的收起时机 | 受控 `open`：流式强制开，结束自动收，用户手动意图优先 | 纯 `<details>` 无法实现「结束后自动收」；受控三者兼顾 F2/F3 |
| 思考耗时 | 前端组件观测 status 变化自行计时 | 后端 part 不携带时长；刷新后历史消息无时长属可接受降级（AC6 验证的是当场会话） |
| 状态文案数据源 | 消息 parts + 已有待决审批轮询，**不新增接口** | 执行轨迹面板已划出范围，observability 数据不引入 |
| reasoning 是否可用 | 不预设；先做 T0 抓流验证并记录结论，F9 降级路径完整实现 | deepseek-v4-flash 经 Mastra 是否吐 reasoning 未经实测，避免设计押注 |
| 工具结果呈现 | pretty JSON（缩进多行）+ 截断 | 满足 F14「可读的层级」且改动最小；自定义类型化渲染器（表格/列表）留待真实需要时再加 |
| 安全（N7） | diff/参数/结果全部以 React 文本节点渲染，禁用 dangerouslySetInnerHTML | React 默认转义即可满足；不引入高亮库（引入即引入注入面） |
| codex 分工 | codex 负责文件级编码（后端 diff、前端四组件、CSS），串行派发 | 沿用 M8-M11 协同模式；运行时验证（抓流、E2E、dev server）由主 agent 执行 |
