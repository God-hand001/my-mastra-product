# M3 定时任务 Plan

> 输入:已批准的 [m3-spec.md](./m3-spec.md)

## 架构概览

```
前端 app/
  ├─ SchedulesPage 定时任务页(侧栏入口)
  │    ├─ 创建表单:描述 + 频率下拉 + 时间选择 → 前端拼 cron → POST
  │    └─ 列表:描述/频率(中文)/状态+下次运行/关联任务入口 + 暂停|恢复/立即执行/删除
  └─ lib/cron.ts(presets ↔ cron 表达式互转)、lib/schedulesClient.ts
        │ HTTP
Mastra server
  └─ /schedules/* 路由(新)→ mastra.schedules CRUD + memory.createThread
        └─ LibSQL 持久化;触发时 agent 执行 → 结果写进绑定线程(现有机制)
```

## 核心接口(后端 `/schedules/*`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/schedules` | 列表:`mastra.schedules.list({agentId:'agent'})`,返回 view(id/prompt/name/cron/status/nextFireAt/threadId…) |
| POST | `/schedules` | 创建:`{title, prompt, cron}` → 先 `memory.createThread({resourceId:'local-user', title})` 得 threadId → `schedules.create({agentId:'agent', cron, prompt, threadId, resourceId, name: title})`;非法 cron 由后端校验报错 |
| POST | `/schedules/:id/pause` · `/resume` · `/run` | 对应 schedules.pause/resume/run |
| DELETE | `/schedules/:id` | schedules.delete(只删调度) |

schedules 视图字段(已从安装版本源码确认):`id / agentId / name? / threadId? / resourceId? / prompt / cron / status / nextFireAt`。

## cron 拼装规则(前端 `lib/cron.ts`)

| 预设 | cron |
|------|------|
| 每天 | `M H * * *` |
| 每周(勾选星期) | `M H * * n…`(1=周一) |
| 工作日 | `M H * * 1-5` |
| 每月(选几号) | `M H D * *` |
| 自定义 | 用户输入原样(后端校验) |

`cronToText(cron)`:已知形态翻成"每天 09:00 / 每周一 08:30 / 工作日 09:00 / 每月 1 号 09:00";不认识的原样显示。

## 模块设计

| 模块 | 职责 |
|------|------|
| `src/mastra/server/schedule-routes.ts`(新) | 上表 6 个路由;创建时 `memory.createThread` 绑定专属线程 |
| `src/mastra/index.ts`(改) | 挂载路由 |
| `app/src/lib/cron.ts`(新) | buildCron / cronToText |
| `app/src/lib/schedulesClient.ts`(新) | HTTP 封装(list/create/pause/resume/runNow/remove) |
| `app/src/routes/SchedulesPage.tsx`(新) | 创建表单(展开式)+ 列表 + 操作按钮 |
| `components/Sidebar.tsx` / `App.tsx`(改) | 入口与路由 |
| `styles/app.css`(改) | 样式 |

## 模块交互

页面创建:表单提交 → `POST /schedules`(后端建线程+建调度)→ 刷新列表;点击关联任务 → `/task/:threadId` 查看执行历史;对话创建(agent 调 start_schedule,绑定当前线程)→ 列表统一可见。

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 页面创建的线程绑定 | 创建时 `memory.createThread` 生成专属线程 | 复用任务机制(N4 零新增存储模型);执行历史可回看 |
| 对话创建的调度 | 列表原样展示(prompt 为描述、threadId 为入口) | F6 统一可见,零额外工作 |
| cron 校验 | 后端 schedules.create 自带 validateCron,非法返回 400 | N1,不重复造轮子 |
| 频率描述 | 前端 cronToText 只翻译已知形态 | 自定义 cron 原样展示,不做完整 NL 化(不做的事) |
| 编辑功能 | M3 不做(删了重建) | spec 不做的事 |
