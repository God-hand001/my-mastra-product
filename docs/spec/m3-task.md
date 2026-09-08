# M3 定时任务 Tasks

> 输入:[m3-spec.md](./m3-spec.md) + [m3-plan.md](./m3-plan.md)

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mastra/server/schedule-routes.ts` | /schedules/* HTTP 路由 |
| 修改 | `src/mastra/index.ts` | 挂载路由 |
| 新建 | `app/src/lib/cron.ts` | buildCron / cronToText |
| 新建 | `app/src/lib/schedulesClient.ts` | HTTP 封装 |
| 新建 | `app/src/routes/SchedulesPage.tsx` | 定时任务页 |
| 修改 | `app/src/components/Sidebar.tsx` | 入口 |
| 修改 | `app/src/App.tsx` | 路由 /schedules |
| 修改 | `app/src/styles/app.css` | 样式 |

## T1: 后端 /schedules 路由

**文件:** `src/mastra/server/schedule-routes.ts`(新建)、`src/mastra/index.ts`
**依赖:** 无
**步骤:**
1. GET `/schedules`:`(await c.get('mastra')).schedules.list({agentId:'agent'})` → c.json
2. POST `/schedules`:body `{title, prompt, cron}` → `mastra.getAgent('agent')` → `agent.getMemory()` → `memory.createThread({resourceId:'local-user', title})` → `schedules.create({agentId:'agent', cron, prompt, threadId, resourceId:'local-user', name:title})` → 返回 `{...view, threadId}`;校验错误(desc 空缺/cron 非法)返回 400 带明确 message
3. POST `/:id/pause`、`/:id/resume`、`/:id/run` → 对应方法;DELETE `/:id` → delete
4. index.ts 挂载(并入 apiRoutes)

**验证:** curl 自测:POST 创建(每天 09:00,描述"汇报当前时间")→ 200 返回含 threadId;GET 列表含该条(status/nextFireAt);POST 非法 cron → 400 带报错;pause/resume/run/delete 各 200

## T2: cron 工具 + schedulesClient

**文件:** `app/src/lib/cron.ts`、`app/src/lib/schedulesClient.ts`(新建)
**依赖:** 无
**步骤:**
1. `cron.ts`:`buildCron({preset, time, weekdays, monthDay})`(预设:每天/每周/工作日/每月/自定义)+ `cronToText(cron)`(已知形态→中文,自定义原样)
2. `schedulesClient.ts`:list/create/pause/resume/runNow/remove 封装;ScheduleView 类型(id/name/prompt/cron/status/nextFireAt/threadId)

**验证:** `./node_modules/.bin/tsc --noEmit`(app/)通过;cronToText 对 4 种预设的转换用临时 node 脚本断言

## T3: SchedulesPage + 入口

**文件:** `app/src/routes/SchedulesPage.tsx`、`components/Sidebar.tsx`、`App.tsx`、`styles/app.css`
**依赖:** T1、T2
**步骤:**
1. 页面:顶部"新建定时任务"按钮展开表单(描述 / 频率下拉 / 按预设显示时间或星期或多选或几号或 cron 输入 / 提交)→ 成功后收起并刷新列表
2. 列表项:描述(name)、频率(cronToText)、状态(运行中·下次 MM-DD HH:mm / 已暂停)、关联任务入口(→ /task/:threadId);操作:暂停/恢复、立即执行、删除
3. 空状态文案(spec F1);Sidebar 加"定时任务"入口;App 注册 /schedules 路由;样式

**验证:** 浏览器:创建/列表/操作全流程(最终验收时统一过 AC);tsc 通过;页面各模块编译通过

## T4: 按 checklist 验收

**文件:** `docs/spec/m3-checklist.md`(阶段四生成)
**依赖:** T3
**步骤:** 阶段六执行:逐项运行 checklist(AC1~AC7),记录证据,出验收报告

## 执行顺序

```
T1 → T2 → T3 → T4
```
