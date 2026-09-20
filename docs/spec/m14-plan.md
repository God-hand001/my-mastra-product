# M14 右栏任务监控面板 Plan

## 架构概览

右栏（PreviewPanel）的「任务摘要」标签页整体替换为「任务监控」页（新组件 TaskMonitor）。数据全部来自现有链路，唯一后端改动是 workspace 列目录端点补 mtime 字段（工作文件按时间排序需要）。

数据源映射（spec N1）：

| 板块 | 数据源 | 获取方式 |
|---|---|---|
| 待办 | 会话消息中 role=signal、type 含 task-list 的消息 | TaskPage 已拉取的 history（`/api/memory/threads/:id/messages`，MastraMessage[]）向下传递；解析最新一条 signal 的任务快照 |
| 最终文件 | 消息文本【产物:】标记 | history 中 assistant 消息文本 parseArtifacts（现成函数） |
| 工作文件 | 沙箱 workspace 目录 | `GET /workspace/files`（补 mtime）+ 任务起点时间过滤，倒序取最近 N 条 |
| 技能与 MCP | history 中 assistant 消息的 toolInvocation parts | toolName 分类：`skill` → 技能；连接器命名空间（`serverName_toolName` 形态且不在已知内置名单）→ MCP |
| 意识更新-短期 | `GET /threads/:id/context` | ContextUsage.percentage（已有组件逻辑可参考） |
| 意识更新-长期 | history 中是否存在【历史摘要】消息 | 存在 → 「有历史摘要」；否则「暂无历史摘要」 |

实时刷新：TaskMonitor 内部 3s interval（与 TaskPage 现有历史轮询节奏一致），运行中 3s、空闲 15s（F16）。刷新只做轻量 fetch + state 更新。

## 核心数据结构

```ts
// 待办项（从 signal 消息解析）
interface TodoItem {
  id: string;            // 任务 id（signal 快照中的 {id}）
  content: string;       // 描述文字
  status: 'pending' | 'in_progress' | 'completed';
}

// 信号消息解析结果（取最新一条全量快照为准）
// signal 消息的 content 形态在 M14-T0 实测确定：可能为 formatTaskListResult 的
// 文本列表("- {id}: {content} ({status})")或结构化 parts，以实测为准写解析器
```

## 模块设计

### 后端：workspace-routes.ts（修改）

**职责：** `GET /workspace/files` 的 entries 增加 `mtimeMs: number`（`fs.readdir withFileTypes` → `stat` 每个 file entry；并行 Promise.all）。其余端点不动。
**依赖：** 无。

### 前端：TaskMonitor.tsx（新建）

**职责：** 四板块监控页（F1-F16）。
**组成：**
- `TaskMonitor({ history, threadId, workspaceSinceRef })`：props 接收 TaskPage 已有的消息数组与 threadId。workspaceSinceRef 记录任务开始时刻（工作文件只显示该时刻后修改的文件；无明确起点时回退显示最近修改的 20 条）
- `TodoSection`：解析 history 最新 task-list signal → TodoItem[]；pending 空心圆、in_progress 转圈、completed 绿勾 + 删除线（N6 状态图标+样式双通道）
- `ArtifactSection({ kind: 'final' | 'work' })`：final=parseArtifacts(history)结果行；work=fetch workspace files 过滤 mtime>since、排除最终文件同名项，倒序取最近 20 条
- `SkillsMcpSection`：遍历 history 的 toolInvocation parts，skill→技能区（取 args.name/skill），连接器工具→MCP 区（stripToolPrefix 前含 `.` 或不属于内置名单——具体判定用 `toolMeta.ts` findRule 未命中 && 含 `_` 命名空间 → MCP，实测校准）
- `MemorySection`：短期=ContextUsage.percentage 进度条 + 「已压缩」徽标（history 有摘要消息时）；长期=「有历史摘要/暂无历史摘要」
- 板块容器 `MonitorSection({ title, empty, children })`：统一折叠（details，默认展开）+ 空态占位文案（F2）
**依赖：** parseArtifacts、toolMeta.stripToolPrefix、contextClient.getContextUsage。

### 前端：PreviewPanel.tsx / TaskPage.tsx（修改）

- PreviewPanel：`summary` kind 的 tab 渲染替换为 TaskMonitor（props 加 history/threadId 透传）；`openTab('summary', ...)` 调用点文案改「任务监控」；SummaryPreview 的入口与「打开任务摘要」按钮移除（SummaryPreview 组件文件保留但不再挂载，避免牵连 grep 之外的引用）
- TaskPage：`openSummaryTab` → `openMonitorTab`（title '任务监控'）；把 history/懒初始化的 workspaceSinceRef 传给 PreviewPanel
- 旧「任务摘要」corner button（599 行）文案同步改

### 前端：app.css（修改）

新增 monitor 系样式：板块卡片、待办状态图标（勾/空心圆/转圈）、完成删除线、记忆进度条、空态文案。色板沿用现有变量。

## 模块交互

```
TaskPage
  ├─ history(已拉取) ──► PreviewPanel ──► TaskMonitor
  │                                        ├─ TodoSection      ◄─ 解析 signal 消息
  │                                        ├─ ArtifactSection  ◄─ parseArtifacts + GET /workspace/files
  │                                        ├─ SkillsMcpSection ◄─ 解析 toolInvocation
  │                                        └─ MemorySection    ◄─ GET /threads/:id/context + history 扫描
  └─ 3s 历史轮询(既有) ──► history 更新 ──► TaskMonitor 重渲染(待办/产物自动同步)
```

## 文件组织

```
my-mastra-product/
├── src/mastra/server/workspace-routes.ts   → entries 补 mtimeMs（改）
├── app/src/components/
│   ├── TaskMonitor.tsx                     → 四板块监控页（新建）
│   ├── PreviewPanel.tsx                    → summary tab → monitor（改）
│   └── app.css                             → monitor 样式（改）
└── app/src/routes/TaskPage.tsx             → 入口与 props 透传（改）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 待办数据源 | 从已拉取的 history 消息解析 signal，**不新增后端端点** | TaskPage 每 3s 已轮询全量消息，signal 消息已在其中（当前被渲染层过滤）；复用即得实时性（N1/N2） |
| signal 解析形态 | M14-T0 实测先行 | formatTaskListResult 是工具结果文本；signal 消息 content 形态（文本 or 结构化）未经实测，plan 不押注 |
| 工作文件范围 | mtime > 任务起点，倒序取 20 条 | spec F7/N2；20 条封顶防空目录风暴 |
| MCP 工具判定 | toolMeta 规则未命中 + 含 `_` 命名空间前缀 | 连接器工具名 `serverName_toolName`；实测校准，宁可漏判不可把内置工具误判为 MCP |
| 摘要功能移除 | 入口/按钮/挂载移除，SummaryPreview 文件保留 | spec F15"整体移除"指入口；文件保留避免牵连未知的静态引用，后续里程碑再清 |
| 任务起点 | TaskPage 挂载时刻（新任务）或首个用户消息时间（历史任务） | 简单可靠；工作文件本就以"最近"为主要诉求 |
```
