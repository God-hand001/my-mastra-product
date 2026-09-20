# M14 右栏任务监控面板 Tasks

> 前置：M13 全部任务验收完成后才开始本清单的 codex 段（单实例纪律）；T0 可提前做。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/mastra/server/workspace-routes.ts` | 列目录 entries 补 mtimeMs |
| 新建 | `app/src/components/TaskMonitor.tsx` | 四板块监控页 |
| 修改 | `app/src/components/PreviewPanel.tsx` | summary tab → monitor |
| 修改 | `app/src/routes/TaskPage.tsx` | 入口改名与 props 透传 |
| 修改 | `app/src/styles/app.css` | monitor 样式 |

## 执行者约定

- **[codex]** T1-T3 严格串行；**[主]** T0、T4 及全部运行时验证复核
- codex 指令书附安全红线（同前：只改清单文件、不联网、不跑 dev server、中文禁 Set-Content）
- 编译验证：根 `npx tsc --noEmit`；前端 `cd app && npm run build`

## T0: signal 消息形态实测 [主]

**文件：** `docs/spec/m14-t0-notes.md`（新建）
**依赖：** 无（可与 M13 并行）
**步骤：**
1. 起 dev server，让 Agent 执行一个会写待办的任务（"先规划 3 个步骤再执行"），从 `/api/memory/threads/:id/messages` 原始响应中提取 role=signal、type 含 task-list 的消息全文
2. 记录 content.parts 形态（文本 or 结构化、任务项字段名与 status 枚举值）
3. 同样记录一条 skill 工具调用与一条连接器工具调用的 toolInvocation 形态（toolName 命名空间样式）
4. 结论写入 notes，指导 T2 解析器写法

**验证：** notes 含原始消息片段与解析器约定

## T1: 列目录补 mtimeMs [codex]

**文件：** `src/mastra/server/workspace-routes.ts`
**依赖：** 无
**步骤：**
1. `GET /workspace/files` 的 file 类型 entries 并行 `stat` 补 `mtimeMs`；目录项可省略
2. 不改端点路径与既有字段（向后兼容）

**验证：** `npx tsc --noEmit` 过；主 agent 起 server 后 curl 确认 entries 含 mtimeMs

## T2: TaskMonitor 组件 [codex]

**文件：** `app/src/components/TaskMonitor.tsx`（新建）
**依赖：** T0（解析器形态）、T1（工作文件排序）
**步骤：**
1. props：`{ history: MastraMessage[]; threadId: string; workspaceSince: number }`
2. `MonitorSection({ title, empty, children })`：details 默认展开、空态占位文案（F2）
3. `TodoSection`：按 T0 结论解析 history 最新 task-list signal → TodoItem[]；completed 绿勾+删除线、in_progress 转圈、pending 空心圆（N6 图标+样式双通道）
4. `ArtifactSection`：final=parseArtifacts(history 中 assistant 文本) 去重；work=fetch `/workspace/files` 过滤 `mtimeMs > workspaceSince` 排除最终文件同名项，倒序取 20；文件行 = 类型图标(复用 M13 FileIcon 如已存在，否则简化 emoji) + 名称，点击触发 `h0-open-artifact`（final 走既有预览标签）
5. `SkillsMcpSection`：history 中 assistant 的 toolInvocation parts：toolName 命中 toolMeta 规则且含 `skill` → 技能区（取 args.name/skill 作显示名，无则 toolName）；未命中规则且含 `_` 命名空间 → MCP 区（显示 `连接器 · 工具名`）；去重
6. `MemorySection`：短期=getContextUsage(threadId) 进度条 + 压缩徽标（history 有【历史摘要】消息时显示「已压缩」）；长期=【历史摘要】存在判断（F13）
7. 内部 3s 轮询仅用于 workspace files 与 context 用量（history 由父组件传入实时更新）；组件卸载清理定时器
8. 全部外部文本纯节点渲染；中文注释

**验证：** `cd app && npx tsc --noEmit` 过

## T3: 接入替换与样式 [codex]

**文件：** `app/src/components/PreviewPanel.tsx`、`app/src/routes/TaskPage.tsx`、`app/src/styles/app.css`
**依赖：** T2
**步骤：**
1. PreviewPanel：`tab.kind === 'summary'` 分支渲染 `<TaskMonitor history threadId workspaceSince />`（props 透传，PreviewPanel props 增加这三个字段）；「打开任务摘要」按钮与 openTab('summary') 调用点文案改「任务监控」；SummaryPreview 挂载移除（文件保留）
2. TaskPage：openSummaryTab → openMonitorTab（title '任务监控'）；workspaceSinceRef（任务起点：新任务=挂载时刻，历史任务=首条用户消息时间）；把 history/threadId/workspaceSince 传给 PreviewPanel
3. 599 行 corner button 文案改「任务监控」
4. app.css：monitor 板块卡片、待办状态图标、删除线、进度条、空态样式；色板沿用现有变量

**验证：** `npm run build` 过；grep `openSummaryTab` 无残留

## T4: 端到端验收 [主]

**文件：** 无（对照 m14-checklist.md）
**依赖：** T0-T3
**步骤：**
1. 起 dev server + 壳，跑 checklist 全部条目
2. 结果记入 `docs/spec/m14-验收报告.md`

**验证：** checklist 逐项有证据

## 执行顺序

```
T0[主](可提前) ─┐
T1 → T2 → T3 → T4[主]
└─ codex 串行段 ─┘
```
