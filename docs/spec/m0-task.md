# M0 任务基座 Tasks

> 输入:[m0-spec.md](./m0-spec.md) + [m0-plan.md](./m0-plan.md)
> 启动方式约定:后端 `npm run dev`(4111),前端 `cd app && npm run dev`(5173)

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `package.json`(根) | 增加 `@ag-ui/mastra` 依赖 |
| 修改 | `src/mastra/index.ts` | 挂载 chatRoute(@mastra/ai-sdk) |
| 修改 | `src/mastra/agents/agent.ts` | 任务型中文 instructions |
| 新建 | `app/package.json` | 前端依赖与脚本 |
| 新建 | `app/vite.config.ts` | 端口 5173 + 代理 /chat、/api → 4111 |
| 新建 | `app/index.html` | 入口 HTML(中文标题) |
| 新建 | `app/src/main.tsx` | 入口 + 路由 |
| 新建 | `app/src/App.tsx` | AppShell 布局 |
| 新建 | `app/src/routes/HomePage.tsx` | 问候语 + 任务输入 |
| 新建 | `app/src/routes/TaskPage.tsx` | 任务视图 |
| 新建 | `app/src/components/Sidebar.tsx` | 侧栏 + 任务列表 |
| 新建 | `app/src/components/TaskInput.tsx` | 大输入框组件 |
| 新建 | `app/src/components/ToolCallCard.tsx` | 工具调用展示 |
| 新建 | `app/src/lib/transport.ts` | AG-UI transport 构造 |
| 新建 | `app/src/lib/agentClient.ts` | threads REST 封装 |
| 新建 | `app/src/lib/taskStore.ts` | 任务列表状态 |

## T1: 后端挂载 AG-UI 端点(含兼容性验证)

**文件:** 根 `package.json`、`src/mastra/index.ts`
**依赖:** 无
**步骤:**
1. 根目录 `npm install @ag-ui/mastra`
2. `src/mastra/index.ts` 中按官方方式挂载:`import { chatRoute } from "@mastra/ai-sdk"`,在 Mastra 构造的 server.apiRoutes 中挂载 chatRoute({ path: "/chat/:agentId" })
3. 重启 `npm run dev`,观察启动无报错

**验证:** `curl -N -X POST http://localhost:4111/chat/agent -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hi"}],"threadId":"t1-test","runId":"r1"}'` → 返回 AI SDK 流式事件(SSE 文本)。**若 chatRoute 挂载报错 → 停止,启用 plan 的兜底决策(自定义 transport 直连 /stream),更新 plan 后继续。**

## T2: agent instructions 任务化

**文件:** `src/mastra/agents/agent.ts`
**依赖:** 无(与 T1 可并行)
**步骤:**
1. 将 instructions 改写为任务执行型中文助手:收到任务先简述计划 → 调用工具执行 → 用中文交付产出;产出文件时按现有约定输出 file:// 链接
2. 保留原有 suggestedPrompts 结构可删减,保持 workspace/memory/tools 配置不动

**验证:** dev server 热重载无报错;Studio 发"列出 workspace 里的文件" → 中文回复且调用工具

## T3: 前端骨架

**文件:** `app/package.json`、`app/vite.config.ts`、`app/index.html`、`app/src/main.tsx`
**依赖:** 无(与 T1/T2 并行)
**步骤:**
1. 手工创建 `app/`:`package.json`(react、react-dom、react-router-dom、vite、@vitejs/plugin-react、typescript)
2. `vite.config.ts`:端口 5173;`server.proxy` 将 `/chat`、`/api` 转发到 `http://localhost:4111`
3. `index.html`(标题"千问助手")与最小 `main.tsx`(渲染 App 占位)
4. `npm install` 后 `npm run dev`

**验证:** 浏览器访问 `http://localhost:5173` 出现占位页;`curl http://localhost:5173/api/agents` 返回后端数据(代理生效)

## T4: 前端接入 assistant-ui 依赖

**文件:** `app/package.json`、`app/src/main.tsx`
**依赖:** T3
**步骤:**
1. `npm install @assistant-ui/react @assistant-ui/ai-sdk-react @ag-ui/mastra @ai-sdk/react`
2. 引入 assistant-ui 基础样式;main.tsx 保持可启动

**验证:** dev 启动无 import 报错

## T5: lib/transport.ts

**文件:** `app/src/lib/transport.ts`
**依赖:** T1、T4
**步骤:**
1. 导出 `createTaskTransport(threadId: string)`:用 `AssistantChatTransport({ api: "/chat/agent" })` 构造并绑定 threadId
2. 导出 `newTaskId()`:生成新任务 id(crypto.randomUUID)

**验证:** 临时在 HomePage 挂一个最小 chat 测试组件发送"你好" → 收到流式回复后移除测试代码(编译通过 + 手工验证)

## T6: lib/agentClient.ts

**文件:** `app/src/lib/agentClient.ts`
**依赖:** T3
**步骤:**
1. 先用 curl 探明线程接口真实格式:`curl "http://localhost:4111/api/memory/threads?resourceId=local-user"` 与删除/标题端点
2. 按真实格式实现 `listThreads()`、`deleteThread(id)`、`renameThread(id, title)`,统一 resourceId 常量 `local-user`

**验证:** 浏览器 console 或临时代码调 `listThreads()` → 返回包含已存在线程的数组

## T7: lib/taskStore.ts

**文件:** `app/src/lib/taskStore.ts`
**依赖:** T6
**步骤:**
1. 轻量状态(优先不引 zustand,用 React context/自定义 hook):tasks 列表、currentTaskId、loadTasks/refresh/removeTask/createTask(生成 id + 本地乐观插入)

**验证:** 编译通过;T9 接入后可见数据

## T8: AppShell + 路由

**文件:** `app/src/App.tsx`、`app/src/main.tsx`
**依赖:** T4
**步骤:**
1. react-router 配置 `/` → HomePage,`/task/:id` → TaskPage
2. AppShell 布局:左侧栏固定宽 + 右侧主区滚动

**验证:** 访问 `/` 显示外壳与首页占位;访问 `/task/abc` 显示任务页占位

## T9: Sidebar + TaskList

**文件:** `app/src/components/Sidebar.tsx`
**依赖:** T7、T8
**步骤:**
1. 侧栏:顶部"新任务"按钮(→ 路由 `/`)、任务列表(标题 + 相对时间,当前任务高亮,hover 出删除)、底部用户占位("god · 个人版")
2. 空状态文案"还未创建过任务"
3. 挂载时 loadTasks,任务完成后刷新

**验证:** 建过任务后列表按最近活跃排序;无任务时显示空状态;点删除 → 列表移除(AC4 前半)

## T10: HomePage

**文件:** `app/src/routes/HomePage.tsx`、`app/src/components/TaskInput.tsx`
**依赖:** T8
**步骤:**
1. 问候语(按当前时段:"早上好/下午好/晚上好")+ 大输入框(居中、大圆角、回车提交)
2. 提交 → `createTask(内容)` → `navigate(/task/{newTaskId})`

**验证:** 输入文字回车 → URL 变为 /task/{uuid} 并进入任务页

## T11: TaskView 接通对话

**文件:** `app/src/routes/TaskPage.tsx`
**依赖:** T5、T8
**步骤:**
1. `useChatRuntime({ transport: createTaskTransport(taskId) })` + AssistantRuntimeProvider + assistant-ui Thread
2. 首次进入且无消息时,自动把创建任务时的输入内容作为首条消息发送
3. 底部输入(任务内追问)+ 停止按钮(runtime 的 stop/cancel)
4. Markdown 渲染(assistant-ui 内置)

**验证:** 发"你好" → 流式中文回复;刷新页面历史仍在;追问"你刚才说了什么" → 上下文正确(AC3、AC4 后半)

## T12: ToolCallCard 工具调用展示

**文件:** `app/src/components/ToolCallCard.tsx`
**依赖:** T11
**步骤:**
1. 用 assistant-ui 的工具消息 fallback 机制注册 ToolFallback 组件:展示工具名、运行状态(进行中/完成)、结果摘要(可折叠)
2. 样式与消息流统一

**验证:** 新任务输入"看一下 workspace 目录里有什么文件" → 消息流中出现工具卡片:先显示"运行中",完成后显示结果摘要(AC2)

## T13: 中文文案与整体打磨

**文件:** 涉及的组件文件
**依赖:** T9~T12
**步骤:**
1. 全部界面文案中文化(标题、按钮、空状态、输入占位)
2. 布局细节:侧栏宽度、问候语字号、输入框圆角阴影,对齐千问办公截图观感

**验证:** AC1 逐项目测通过

## T14: 按 checklist 验收

**文件:** 无新改动
**依赖:** T13
**步骤:** 阶段六执行:逐项运行 `docs/spec/m0-checklist.md`,记录证据,出验收报告

## 执行顺序

```
T1(后端)→ T2
T3 → T4 → T8
T1+T4 完成后:T5 → T6 → T7
T8 完成后:T9、T10(可并行)→ T11 → T12 → T13 → T14
```
