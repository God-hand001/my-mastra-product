# M0 任务基座 Plan

> 输入:已批准的 [m0-spec.md](./m0-spec.md)

## 架构概览

```
┌────────────────────────────────────┐
│ 前端 app/(Vite + React + TS)        │
│  ├─ 应用外壳:侧栏(新任务/最近任务) │
│  │   + 问候语 + 任务输入框           │
│  ├─ assistant-ui 聊天组件(任务内)   │
│  └─ useChatRuntime + Transport      │
└─────────┬──────────────┬───────────┘
          │ AI SDK 流式    │ REST
          │ /chat/agent   │ /api/memory/threads
┌─────────▼──────────────▼───────────┐
│ Mastra server(localhost:4111)      │
│  ├─ chatRoute 挂载的对话端点        │
│  ├─ Agent(deepseek)+ Memory        │
│  ├─ workspace / schedule 等工具     │
│  └─ LibSQL 存储(线程/消息,已配好)  │
└────────────────────────────────────┘
```

**核心映射:一个任务 = 一个 Mastra 记忆线程(thread)。**

| 千问办公概念 | 本产品实现 |
|-------------|-----------|
| 新任务 | 新建 thread → 进入任务视图 |
| 任务内对话 | 同一 thread 内继续发消息(AI SDK 流式) |
| 最近任务 | thread 列表(Memory `generateTitle: true` 自动生成任务标题) |
| 任务历史持久化 | LibSQL(后端已配好,零新增存储) |
| 任务删除 | 删除 thread |

## 核心数据结构

### Task(前端领域模型,由 thread 映射,不新建后端存储)

- `id: string` —— 即 threadId
- `title: string` —— agent 自动生成的任务标题
- `createdAt: string` / `updatedAt: string` —— 排序与展示
- `isRunning: boolean` —— 前端运行态(内存态,不持久化)

### 后端接口(全部为 Mastra 现有/新增挂载,不自建服务)

| 接口 | 用途 |
|------|------|
| `POST /chat/agent`(AI SDK 流式,`@mastra/ai-sdk` 的 chatRoute) | 任务执行 + 任务内对话(带 threadId) |
| `GET /api/memory/threads?resourceId=…` | 最近任务列表 |
| `DELETE /api/memory/threads/:id` | 删除任务 |
| 线程标题更新接口(client SDK) | 重命名(存在性在任务阶段验证) |

## 模块设计

### 前端(app/,新建)

| 模块 | 职责 | 对应 spec |
|------|------|----------|
| AppShell | 全局布局:左侧栏 + 主区,路由容器(`/` 首页,`/task/:id` 任务视图) | F1 |
| Sidebar + TaskList | 新任务按钮、最近任务列表(fetch threads、按最近活跃排序)、底部用户占位 | F1、F4 |
| HomePage | 问候语 + 大任务输入框;提交即创建任务并跳转 | F1、F2 |
| TaskView | 任务标题 + assistant-ui 消息流(Markdown、工具调用卡片)+ 底部追问输入 + 停止按钮 | F2、F3、F5 |
| ToolCallCard | 工具调用展示(名称/状态/结果摘要) | F2 |
| lib/agentClient | threads REST 封装(列表/删除/标题) | F4 |
| lib/transport | AI SDK transport 构造(AssistantChatTransport,threadId 绑定) | F2、F3 |
| lib/taskStore | 任务列表与当前任务状态(轻量) | F4 |

### 后端(现有项目,小改)

| 模块 | 改动 |
|------|------|
| `src/mastra/index.ts` | 挂载 `chatRoute`(`@mastra/ai-sdk`)暴露 agent 为 `/chat/agent` |
| `src/mastra/agents/agent.ts` | instructions 微调:任务执行型中文助手(先规划 → 调工具 → 交付产出) |

## 模块交互

**创建任务:** HomePage 输入 → 生成新 threadId → 跳转 `/task/:id` → TaskView 首发消息走 AI SDK 流式 → Mastra agent 执行(文本/工具调用事件流)→ assistant-ui 渲染 → 完成后刷新侧栏(标题由后端自动生成)

**任务内对话:** 同一 transport 继续发送(threadId 不变,上下文天然延续)

**任务列表:** Sidebar 挂载时 `listThreads(resourceId='local-user')` → 渲染;删除 → DELETE → 刷新

**开发期跨域:** Vite dev server 把 `/chat` 和 `/api` 代理到 `localhost:4111`(前端不直接处理 CORS,N5 边界不变)

## 文件组织

```
my-mastra-product/
├── src/mastra/
│   ├── index.ts              # 修改:挂载 chatRoute
│   └── agents/agent.ts       # 微调:任务型中文 instructions
├── app/                      # 新建前端(Vite + React + TS)
│   ├── package.json
│   ├── vite.config.ts        # 端口 5173;/chat、/api 代理到 4111
│   ├── index.html
│   └── src/
│       ├── main.tsx          # 入口 + 路由
│       ├── App.tsx           # AppShell
│       ├── routes/
│       │   ├── HomePage.tsx
│       │   └── TaskPage.tsx
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   ├── TaskInput.tsx
│       │   └── ToolCallCard.tsx
│       └── lib/
│           ├── agentClient.ts
│           ├── transport.ts
│           └── taskStore.ts
└── docs/spec/m0-spec.md      # 已有
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 任务模型 | 任务 = Mastra thread | 零新增存储、复用自动标题、M2/M3 可在同一模型上扩展 |
| 集成方式 | `@mastra/ai-sdk` 的 `chatRoute({ path: '/chat/:agentId' })` + 前端 `AssistantChatTransport` | 与安装的 core 1.64.0 精确匹配的官方 assistant-ui 集成路径(本地嵌入文档确认);web 检索到的 `registerAGUI`/`@ag-ui/mastra` API 在实际包中不存在,已弃用 |
| 兜底方案 | 若 chatRoute 与 core 1.64.0 不兼容 → 自定义 transport 直连 `/api/agents/:id/stream` | 保证集成不被卡死,任务阶段第一项验证 |
| 前端栈 | Vite + React + TS,放 `app/` 子目录(自带 package.json) | 轻量;与 Coworker 的 `app/` 结构同构,便于对照 |
| 包管理 | 全项目统一 npm(Node 22) | 机器现状,不引 Bun |
| 前端状态 | assistant-ui runtime 自带状态优先,不够再加 zustand | 简单优先 |
