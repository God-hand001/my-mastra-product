# H0 项目系统 Plan

> 输入:已批准的 [h0-spec.md](./h0-spec.md)

## 架构概览

```
前端 app/
├─ 侧栏「项目」分组 + 新建项目弹窗
├─ 首页「当前项目」选择器(输入框上方下拉)
└─ TaskPage 发消息携带 requestContext:{model, projectDir, projectName}
      │ HTTP(appapi:// / vite 代理)
Mastra server
├─ /projects CRUD + /projects/link(新路由,JSON 持久化 storage/projects.json)
├─ 项目工具 3 件套(新,注册到 agent):
│    project_list_files / project_read_file / project_write_file
│    execute 从 requestContext 读 projectDir → 校验注册 → node:fs 操作
└─ agent.model 动态解析(已有,requestContext.model)
```

## 核心接口(后端 `/projects`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 项目列表 `[{id, name, dir, createdAt}]` |
| POST | `/projects` | 创建 `{name, dir}`(dir 选填;名称唯一性不强制);返回项目 |
| DELETE | `/projects/:id` | 删除项目(同时解除其线程绑定关系) |
| POST | `/projects/link` | `{threadId, projectId}` 绑定线程 ↔ 项目(JSON 记录) |
| GET | `/projects/links` | 绑定关系列表 `[{threadId, projectId}]` |

## 项目工具(agent,注册到 tools)

| 工具 id | 功能 | execute 逻辑 |
|---------|------|-------------|
| `project_list_files` | 列出项目目录内容 | requestContext.projectDir → 校验注册 → fs.readdir(递归一层) |
| `project_read_file` | 读取项目文件 | 相对路径拼接 projectDir → 防穿越校验 → readFile(文本,≤30 万字符) |
| `project_write_file` | 写入项目文件 | 相对路径 + 内容 → 防穿越校验 → writeFile(自动建父目录) |

未激活(requestContext 无 projectDir)或目录未注册 → 返回提示文本,不执行 fs 操作(N1/AC5)。

## 模块设计

| 模块 | 职责 |
|------|------|
| `src/mastra/services/project-store.ts`(新) | 项目 CRUD(JSON 持久化)+ 线程绑定关系 + 目录校验 |
| `src/mastra/server/project-routes.ts`(新) | /projects 路由 |
| `src/mastra/tools/project-tools.ts`(新) | 项目工具 3 件套(execute 从 requestContext 取 projectDir) |
| `src/mastra/agents/agent.ts`(改) | 注册项目工具;instructions 增加项目行为说明 |
| `src/mastra/index.ts`(改) | 挂载路由 |
| `app-desktop/preload.js`(新) | contextBridge 暴露 selectDirectory(IPC → dialog.showOpenDialog) |
| `app-desktop/main.js`(改) | ipcMain.handle('select-directory');加载 preload |
| `app/src/lib/projectsClient.ts`(新) | /projects HTTP 封装 + selectDirectory(桌面 IPC / 浏览器回退 null) |
| `app/src/components/ProjectModal.tsx`(新) | 新建项目弹窗(名称 + 目录选择/输入) |
| `app/src/components/Sidebar.tsx`(改) | 「项目」分组 + 弹窗入口 + 点击筛选 |
| `app/src/routes/HomePage.tsx` + `components/TaskInput.tsx`(改) | 当前项目选择器 |
| `app/src/routes/TaskPage.tsx`(改) | requestContext 注入 {model, projectDir, projectName};首次消息 POST link |
| `app/src/lib/taskStore.ts`(改) | 项目筛选状态(侧栏点击项目 → 最近任务过滤) |
| `styles/app.css`(改) | 样式 |

## 关键技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 项目存储 | JSON 文件(storage/projects.json) | 与 drive-store 同模式,量小,重启持久 |
| agent 项目文件能力 | 独立项目工具 + requestContext 激活 | 不动 workspace/沙箱工具链;安全边界清晰(仅注册目录) |
| projectDir 校验 | 后端工具 execute 内比对已注册项目目录(realpath 归一化) | 防伪造/穿越(AC5/N1) |
| 线程绑定时机 | TaskPage 首次发消息成功后 POST /projects/link | 绑定真实存在的线程;失败不产生孤儿绑定 |
| 目录选择 | Electron IPC 原生对话框(preload 桥) | 桌面端专属;浏览器不出项目入口(N4) |
| 侧栏筛选 | taskStore 前端过滤(selectedProject 状态) | 线程↔项目关系已在手,纯前端过滤即可 |
