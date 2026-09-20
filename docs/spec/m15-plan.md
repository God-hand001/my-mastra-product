# M15 场景工作台角色切换 Plan

## 架构概览

四层改动，对齐千问双通道架构（前端持久化 + 请求内联）：

1. **角色配置层**（纯常量）：`workbenchRoles.ts` 定义 `WorkbenchRole` 类型与 4 个内置角色（systemPrompt 文案由主 agent 提供，codex 负责代码结构）
2. **状态层**（Zustand 新依赖）：`workbenchStore.ts` 维护 per-thread 角色 Map + localStorage 持久化；角色锁定逻辑（thread 有消息后锁定）由组件侧根据消息数判断，store 只存映射
3. **请求层**：transport 的 requestContext 增加 `role`；agent.ts 的 instructions 按 role 拼接角色 systemPrompt + artifactHint，skills resolver 按角色白名单过滤（复用 M10 机制）
4. **产物层**：`<artifact>` 标签解析剥离（挂入 AssistantText）+ 右侧渲染器路由（html 沙箱 iframe / slides 三标签工作区 / doc Markdown+导出）+ ask_user 提问工具与问题面板（复用 M11 suspend/恢复链路）

## 核心数据结构

```ts
// workbenchRoles.ts
export type RoleId = 'general' | 'design' | 'slides' | 'writing';
export interface WorkbenchRole {
  id: RoleId;
  label: string;            // 中文名
  icon: string;             // emoji（对齐千问菜单形态）
  description: string;      // 欢迎页/工具提示用
  systemPrompt: string;     // 追加到基础指令后；general 为空串
  artifactHint: string;     // <artifact> 输出格式约定（拼入 instructions）
  enabledSkills: string[] | null;  // null = 不限（general）
  artifactType: 'none' | 'html' | 'slides' | 'doc';
  defaultRenderer: 'markdown' | 'sandbox-iframe' | 'slides-workspace' | 'doc-viewer';
}
export const WORKBENCH_ROLES: readonly WorkbenchRole[];

// workbenchStore.ts
interface WorkbenchState {
  rolesByThread: Record<string, RoleId>;
  setRole(threadId: string, role: RoleId): void;
  roleOf(threadId: string | undefined): RoleId;  // 无记录 → 'general'
}
// persist 中间件,key 'workbench:sessionRoles'
```

## 模块设计

### 前端：workbenchRoles.ts / workbenchStore.ts（新建）

- roles 常量（systemPrompt 由主 agent 在指令书中提供全文，codex 只做录入）；general 的 systemPrompt 为空且 enabledSkills=null
- store 用 zustand persist（partialize 只存 rolesByThread）；派生 selector `useCurrentRole()`（结合当前 threadId，由调用方传入）
- 新任务判定：thread 消息数为 0（组件侧用 `runtime.thread.getState().messages.length === 0`）

### 前端：RoleSelector.tsx（新建）+ ChatThread.tsx（改）

- 触发胶囊：`icon + label + ▾`；菜单纵向 4 项（icon+label+当前绿勾）；外部点击/Esc 关闭（复用标签右键菜单的实现模式）
- 显示条件：`messages.length === 0`（新任务）；锁定后不渲染
- 位置：ChatThread 工具栏左组，ConnectorPicker 之后、PermissionSelect 之前

### 前端：transport.ts（改）

- `requestContext` 增加 `role: roleOf(threadId)`——从 store 读（store 与 transport 解耦：transport 的 body 工厂里 `useRoleStore.getState().roleOf(threadId)`）

### 后端：agent.ts（改）

- `instructions` 改为函数形态（已是 string，改动态）：基础指令 + `\n\n` + 角色 systemPrompt（非 general 时）+ artifactHint
- `skills` resolver：requestContext.role 存在且角色 enabledSkills 非空 → enabledSkillDirs 与白名单取交集（user-requested-skill inline 技能不受限，F9）

### 前端：artifactTag.ts（新建）+ AssistantSteps.tsx（改）

- `parseArtifactTags(text)`：解析 `<artifact type="..." title="...">…</artifact>`（非贪婪、多实例、跨行）；`stripArtifactTags(text)` 剥离
- AssistantText：先剥离 artifact 标签（在产物标记清洗之前），生成产物卡（复用 M13 ArtifactCard 长卡形态，title/type 显示；点击进预览）——**聊天流不再出现标签内容**
- type 缺失时按当前会话角色 artifactType 补齐（F12）——AssistantText 需感知当前角色：从 props 传入（AssistantMessage 层读 store）

### 前端：PreviewPanel 渲染器路由（改）+ 导出

- html：现有 FilePreview html 分支的 iframe 加 `sandbox="allow-scripts allow-forms"`（对齐 F11 安全约束，**不加 allow-same-origin**）；生成前骨架占位（产物卡已在但内容未就绪时不适用——骨架只用于 pptx/html 加载中态）
- slides：新 `SlidesWorkspace` 组件——三标签（幻灯片=iframe 渲染 1280 画布 fit 缩放；大纲=会话内最新大纲文本；源文件=HTML 源码查看+复制）；导出按钮 → 现有 html_to_pptx 链路（POST 转换 → 下载）
- doc：`DocViewer`——Markdown 渲染（复用 MarkdownText）+ 导出 Word（Markdown→HTML→ 现有 html_to_docx 端点 → 下载）
- 路由入口：产物卡的 type 决定 PreviewPanel 打开时的 tab kind（'slides' | 'doc' | 既有 'file'）

### 后端：ask-user.ts（新建）+ approval-routes.ts（改）+ agent.ts tools（改）

- `ask_user` 工具：inputSchema `{ questions: [{ id, title, hint?, type: 'single'|'multi'|'text', options?: [{label, description}], allowCustom? }] }`；execute 内 suspend（**照抄 sandbox-elevation 的 suspend/resume 模式**），suspend payload = 问题数组
- 恢复路由：`POST /ask-user/answer`（body `{ runId, toolCallId, answers }`）——resume 流（参考 M11 审批的恢复实现）；「AI 自行决定」= answers 传空对象
- tools 列表挂载 ask_user；仅 design/slides 角色暴露（tools 函数按 requestContext.role 条件挂载，general 不挂）

### 前端：AskUserPanel（新建，挂入 PreviewPanel）

- 挂起状态数据源：复用审批轮询模式（GET 挂起列表——需后端提供 ask-user 挂起查询端点，或复用 approval-routes 的列表扩展 type）→ 新增「问题」tab
- 表单渲染 + 提交（收集答案 → POST answer → 刷新状态）+「AI 自行决定」

### 前端：app.css

monitor 之外的 m15 样式节：RoleSelector 胶囊与菜单、slides 三标签、doc 导出条、问题表单。

## 模块交互

```
新任务（messages=0）：RoleSelector 显示 → 用户选角色 → store.setRole(threadId, role)
首条消息发出 → 锁定（messages>0，选择器消失）
每次请求：transport requestContext.role=store.roleOf(threadId)
  → agent.ts instructions += 角色 systemPrompt+artifactHint；skills=白名单交集
模型输出 <artifact> → AssistantText 剥离 → 产物卡 → 点击 → PreviewPanel
  → type 路由渲染器（sandbox-iframe / slides-workspace / doc-viewer）
模型调用 ask_user → suspend → 会话挂起
  → 前端轮询发现挂起 → PreviewPanel「问题」tab + 状态行「等待你的回答…」
  → 提交答案 → POST /ask-user/answer → resume → 模型继续
```

## 文件组织

```
my-mastra-product/
├── src/mastra/
│   ├── agents/agent.ts                 → instructions 动态化 + skills 过滤 + 挂载 ask_user（改）
│   ├── tools/ask-user.ts               → ask_user 工具（新建）
│   └── server/approval-routes.ts       → ask-user 挂起查询/答案恢复端点（改）
├── app/src/
│   ├── lib/workbenchRoles.ts           → 类型+4角色（新建）
│   ├── lib/workbenchStore.ts           → Zustand store（新建）
│   ├── lib/artifactTag.ts              → <artifact> 解析剥离（新建）
│   ├── components/RoleSelector.tsx     → 选择器（新建）
│   ├── components/SlidesWorkspace.tsx  → slides 三标签（新建）
│   ├── components/DocViewer.tsx        → doc 渲染+导出（新建）
│   ├── components/AskUserPanel.tsx     → 问题表单（新建）
│   ├── components/ChatThread.tsx       → RoleSelector 接入（改）
│   ├── components/AssistantSteps.tsx   → 标签剥离挂接（改）
│   ├── components/PreviewPanel.tsx     → 渲染器路由（改）
│   └── styles/app.css                  → m15 样式（改）
└── package.json                        → zustand 依赖（改）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 状态库 | Zustand persist（新依赖） | 用户指定（学习目的）；按 threadId 分片与千问 pa(chatId) atom 同构 |
| 锁定判定 | 组件侧按消息数判定，store 不存 locked 标记 | 消息数是权威且实时（runtime），派生即可，避免双状态源 |
| 角色注入 | requestContext 内联（每请求） | 千问通道 B 同构；单条消息角色必然正确；无服务端 schema 变更 |
| skills 过滤 | 白名单交集在 resolver 内做，user-requested-skill 豁免 | F9 兼容斜杠技能；general 不限 |
| ask_user 挂起 | 复用 M11 suspend/resume | 同构机制零新概念；general 不挂载该工具（角色条件挂载） |
| 幻灯片产物 | 单 HTML 文件多 section（对齐 M7 约定），SlidesWorkspace iframe 渲染 | 不自造多文件格式；PPTX 导出走既有 html_to_pptx |
| doc 导出 | Markdown→HTML→html_to_docx | 复用 M7 链路，无新转换器 |
| systemPrompt 文案 | 主 agent 在指令书中提供全文，codex 录入 | 提示词是产品核心内容，文案质量由主 agent 把关 |

## 开发顺序

M15 开发排 M13 验收与 M14 之后；T0（zustand 安装）与 T1-T8（codex 串行 4 批）、T9 验收。
