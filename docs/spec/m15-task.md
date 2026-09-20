# M15 场景工作台角色切换 Tasks

> 前置：M14 全部任务验收完成后才开始 codex 段（单实例纪律）；T0 可提前做。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `package.json`（根） | zustand 依赖 |
| 新建 | `app/src/lib/workbenchRoles.ts` | 角色类型 + 4 角色配置 |
| 新建 | `app/src/lib/workbenchStore.ts` | Zustand 会话角色状态 |
| 新建 | `app/src/components/RoleSelector.tsx` | 角色选择器 |
| 修改 | `app/src/components/ChatThread.tsx` | 选择器接入工具栏 |
| 修改 | `app/src/lib/transport.ts` | requestContext.role |
| 修改 | `src/mastra/agents/agent.ts` | instructions 动态化 + 技能过滤 + 挂载 ask_user |
| 新建 | `app/src/lib/artifactTag.ts` | `<artifact>` 标签解析剥离 |
| 修改 | `app/src/components/AssistantSteps.tsx` | 标签剥离挂接 |
| 修改 | `app/src/components/PreviewPanel.tsx` | 渲染器路由 |
| 新建 | `app/src/components/SlidesWorkspace.tsx` | slides 三标签工作区 |
| 新建 | `app/src/components/DocViewer.tsx` | doc 渲染 + 导出 Word |
| 新建 | `src/mastra/tools/ask-user.ts` | ask_user 工具（suspend） |
| 修改 | `src/mastra/server/approval-routes.ts` | 挂起查询 + 答案恢复端点 |
| 新建 | `app/src/components/AskUserPanel.tsx` | 问题表单面板 |
| 修改 | `app/src/styles/app.css` | m15 样式 |

## 执行者约定

- **[codex]** T1-T7 严格串行分 3 批；**[主]** T0、T8 及全部运行时验证复核
- codex 指令书附安全红线（同前）；编译验证：根 `npx tsc --noEmit`、前端 `cd app && npm run build`
- 角色 systemPrompt 文案由主 agent 在指令书中提供全文，codex 只录入不改写

## T0: 依赖与文案准备 [主]

**步骤：**
1. `npm install zustand`（根）；`node -e "require('zustand')"` 验证（zustand 是 ESM，用 `node --input-type=module` 或查 package.json version 确认）
2. 撰写 4 角色 systemPrompt + artifactHint 全文（design：单文件 HTML 产物 + `<artifact type="html" title>` 约定 + 沙箱环境约束——无外部依赖、内联样式/脚本；slides：先大纲征求确认→确认后单 HTML 多 section 1280×720 + PPTX 导出说明；writing：Markdown 长文 + `<artifact type="doc">` 约定；general：空）
3. 文案直接写入 T1 指令书

**验证：** zustand 版本号记录进汇报

## T1: 角色配置与会话状态 [codex]

**文件：** `app/src/lib/workbenchRoles.ts`、`app/src/lib/workbenchStore.ts`
**依赖：** T0
**步骤：**
1. workbenchRoles.ts：`RoleId`/`WorkbenchRole` 类型（见 plan）+ `WORKBENCH_ROLES` 常量（主 agent 提供的 4 角色全文录入）+ `getRole(id): WorkbenchRole`（未知 id 回落 general）
2. workbenchStore.ts：zustand + persist（key `workbench:sessionRoles`，partialize 只存 rolesByThread）；`setRole`/`roleOf(threadId)`（无记录→'general'）；教学级注释（为什么按 threadId 分片、为什么 persist）
3. `npm install zustand` 需在 app 目录？——zustand 是前端依赖，装在 **app/package.json**（`cd app && npm install zustand`，由主 agent 在 T0 执行，codex 跳过安装直接 import）

**验证：** `cd app && npx tsc --noEmit` 过

## T2: RoleSelector 与工具栏接入 [codex]

**文件：** `app/src/components/RoleSelector.tsx`、`app/src/components/ChatThread.tsx`
**依赖：** T1
**步骤：**
1. RoleSelector：props `{ threadId, messagesCount }`；`messagesCount > 0` 返回 null（锁定）；触发胶囊 `icon+label+▾`（icon/label 来自 store 当前角色）；菜单纵向 4 项（icon+label+当前绿勾）；外部点击/Esc 关闭（参考标签右键菜单实现）
2. 点击项 → `setRole(threadId, id)` → 关闭菜单 → 短暂提示「已切换到{角色名}」（仅未锁定时有意义，新任务阶段切换不提示，直接选完即可——提示条做在锁定发生的那次发送后不需要，简化：不做提示条，F15 降级为选完即生效）——**修正：F15 保留但仅对新任务阶段切换生效**
3. ChatThread：工具栏左组 ConnectorPicker 之后插入 `<RoleSelector threadId messagesCount />`；messagesCount 从 runtime 取

**验证：** `cd app && npx tsc --noEmit` 过

## T3: 请求链路（前端携带 + 后端组装）[codex]

**文件：** `app/src/lib/transport.ts`、`src/mastra/agents/agent.ts`
**依赖：** T1
**步骤：**
1. transport.ts：body 工厂的 requestContext 增加 `role: useWorkbenchStore.getState().roleOf(threadId)`（store 与 transport 解耦：.getState() 直接读，不 hook）
2. agent.ts：`instructions` 改为函数（`({ requestContext }) => string`）：基础指令 + 角色 systemPrompt（非 general）+ artifactHint；`skills` resolver：角色 enabledSkills 非空 → enabledSkillDirs 结果与白名单交集；user-requested-skill inline 技能不受限
3. 保持 requestContext 其他字段（model/skill/projectDir/permission）行为不变

**验证：** 根 `npx tsc --noEmit` 过；主 agent 起 server 后 curl 验证 general 与 design 两种角色的请求 system prompt 差异（通过让模型复述身份）

## T4: artifact 标签解析与剥离 [codex]

**文件：** `app/src/lib/artifactTag.ts`（新建）、`app/src/components/AssistantSteps.tsx`
**依赖：** T1（角色类型）、T2 前可并行
**步骤：**
1. artifactTag.ts：`parseArtifactTags(text)` → `{ type, title, content, raw }[]`（非贪婪、多实例、跨行 DOTALL）；`stripArtifactTags(text)` 清洗（残留防御同【产物:】模式）；type 合法值 html/slides/doc
2. AssistantSteps：AssistantText 中在【产物:】清洗**之前**剥离 artifact 标签 → 解析出的产物渲染为 ArtifactCard 形态（title + type 图标；点击 dispatch `h0-open-artifact` 扩展 detail 带 `{kind:'artifact-tag', type, content, title}`）——content 不落盘，走内存传给预览
3. type 缺失：调用方传当前角色 artifactType 补齐（AssistantText 接收 roleArtifactType prop，AssistantMessage 从 store 读）
4. PreviewPanel 侧 artifact-tag 产物的打开路由在 T5 实现，本任务只保证剥离与卡片

**验证：** `cd app && npx tsc --noEmit` 过；断言脚本（主 agent 复核时跑）：多标签/跨行/缺 type 三用例

## T5: 右侧渲染器路由 [codex]

**文件：** `app/src/components/PreviewPanel.tsx`、`app/src/components/SlidesWorkspace.tsx`（新建）、`app/src/components/DocViewer.tsx`（新建）
**依赖：** T4
**步骤：**
1. PreviewPanel：新 tab kind `artifact-tag`——payload `{type, title, content}`；openArtifactTab 事件消费端（TaskPage）新增该 kind 的分支（或转换成 kind:'file' 之外的内存 tab——实现取最小改动：新增 kind + PreviewContent 分支）
2. html type：iframe `sandbox="allow-scripts allow-forms"` + `srcDoc={content}`（**不用** src 外链；无 allow-same-origin）；加载态骨架占位
3. slides type：`SlidesWorkspace` 三标签——幻灯片（iframe srcDoc + 1280 宽 fit 缩放：容器宽/1280 比例 transform scale）；大纲（props 传入会话最新大纲——由 TaskPage 从 history 抓取 slides 模式下首条 assistant 大纲文本，简化：大纲 tab 显示「大纲已在对话中输出」提示 + 跳转链接不做，v1 显示占位说明）；源文件（`<pre>{content}</pre>` + 复制按钮）；导出 PPTX 按钮 → POST html_to_pptx 既有端点（payload 为 content）→ 下载
4. doc type：`DocViewer`——MarkdownText 渲染 content + 「导出 Word」按钮 → Markdown 转 HTML（marked 或已有 MarkdownText 的 html 输出；无现成则用 `marked` 需主 agent 确认依赖——**用已有 MarkdownText 无法取 html，改用 prompt 约定：doc 产物 content 直接是 HTML**（模型输出 HTML 片段），DocViewer iframe srcDoc 渲染 + html_to_docx 导出）——**最终约定：doc 产物 content = HTML 文档片段**，spec F2 措辞按此理解
5. 主 agent 备注演进：导出实现若遇端点参数不匹配，以 M7 端点实际签名为准调整并在汇报说明

**验证：** `cd app && npm run build` 过

## T6: ask_user 工具与恢复端点 [codex]

**文件：** `src/mastra/tools/ask-user.ts`（新建）、`src/mastra/server/approval-routes.ts`、`src/mastra/agents/agent.ts`
**依赖：** T3
**步骤：**
1. ask-user.ts：照抄 `sandbox-elevation.ts` 的 suspend/resume 模式——inputSchema `{ questions: [{ id, title, hint?, type: 'single'|'multi'|'text', options?: [{label, description}], allowCustom? }] }`；execute 中 suspend；suspend payload = questions
2. agent.ts tools：`ask_user` 挂载为条件工具（requestContext.role ∈ {design, slides} 时才包含；general 不暴露）——tools 函数按 requestContext 判断（参考现有 requestContext 用法）
3. approval-routes.ts：挂起查询列表扩展 type 'ask-user'（payload 含 questions）；新增 `POST /ask-user/answer` `{runId, toolCallId, answers}` → resume（answers 为 Record<questionId, string|string[]>，AI 自行决定=空对象）——恢复实现参考既有提权恢复
4. 挂起查询端点需带 type 字段供前端区分审批与提问

**验证：** 根 `npx tsc --noEmit` 过；主 agent 真实调用验证挂起/恢复

## T7: AskUserPanel 前端 [codex]

**文件：** `app/src/components/AskUserPanel.tsx`（新建）、`app/src/components/PreviewPanel.tsx`、`app/src/components/ChatThread.tsx`（状态行）、`app/src/styles/app.css`
**依赖：** T6
**步骤：**
1. AskUserPanel：props `{ questions, onSubmit(answers), onDecide() }`——渲染编号+标题+说明+选项卡（single 圆点/multi 方框/options 含 label+description）+ allowCustom 时「其他（请填写）」输入；底部「提交答案」「AI 自行决定」；本地 state 收集答案
2. PreviewPanel：轮询发现 type='ask-user' 挂起时自动开「问题」tab（挂 AskUserPanel）
3. ChatThread 状态行：挂起 type='ask-user' 时文案「等待你的回答…」（复用 computePhaseLabel 的覆盖机制——approval 等待分支扩展）
4. 样式入 app.css（问题卡、选项卡、提交条）

**验证：** `cd app && npm run build` 过

## T8: 端到端验收 [主]

**文件：** 无（对照 m15-checklist.md）
**依赖：** T0-T7
**步骤：**
1. dev server + 壳，跑 checklist 全部条目（四角色行为/锁定/恢复/标签产物/三渲染器/提问流/导出）
2. 结果记入 `docs/spec/m15-验收报告.md`

**验证：** checklist 逐项有证据

## 执行顺序

```
T0[主] → T1 → T2 ──────┐
        T3 ────────────┤
        T4 → T5 ───────┤ batch 划分:批1=T1+T2,批2=T3+T4+T5,批3=T6+T7 → T8[主]
        T6 → T7 ───────┘
codex 串行段:批1 → 批2 → 批3
```
