# H0 项目系统 Tasks

> 输入:[h0-spec.md](./h0-spec.md) + [h0-plan.md](./h0-plan.md)

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mastra/services/project-store.ts` | 项目 CRUD + 线程绑定(JSON 持久化) |
| 新建 | `src/mastra/server/project-routes.ts` | /projects 路由 |
| 新建 | `src/mastra/tools/project-tools.ts` | 项目工具 3 件套 |
| 修改 | `src/mastra/index.ts` | 挂载路由 |
| 修改 | `src/mastra/agents/agent.ts` | 注册项目工具 + instructions |
| 新建 | `app-desktop/preload.js` | IPC 目录选择桥 |
| 修改 | `app-desktop/main.js` | ipcMain.handle + preload 加载 |
| 修改 | `app-desktop/package.json` | main 入口加 preload |
| 新建 | `app/src/lib/projectsClient.ts` | /projects 封装 + selectDirectory |
| 新建 | `app/src/components/ProjectModal.tsx` | 新建项目弹窗 |
| 修改 | `app/src/components/Sidebar.tsx` | 「项目」分组 + 筛选 |
| 修改 | `app/src/lib/taskStore.ts` | selectedProject 状态 |
| 修改 | `app/src/routes/HomePage.tsx` | 当前项目选择器 |
| 修改 | `app/src/components/TaskInput.tsx` | 选择器展示 |
| 修改 | `app/src/routes/TaskPage.tsx` | requestContext 注入 + link 绑定 |
| 修改 | `app/src/styles/app.css` | 样式 |

## T1: 后端 project-store + /projects 路由

**文件:** `services/project-store.ts`、`server/project-routes.ts`、`index.ts`
**依赖:** 无
**步骤:**
1. project-store:`loadProjects/saveProject/deleteProject`(storage/projects.json)、`linkThread(threadId, projectId)`、`getLinks()`、`resolveProjectDir(projectId)`(返回注册目录,不存在返回 null)
2. 路由:GET /projects;POST /projects{name, dir?};DELETE /projects/:id;POST /projects/link;GET /projects/links
3. index.ts 挂载

**验证:** curl:创建 → 列表含该条 → link 一线程 id → links 可查 → delete 后项目与绑定消失

## T2: 项目工具 + agent 注册

**文件:** `tools/project-tools.ts`、`agents/agent.ts`
**依赖:** T1
**步骤:**
1. 三工具:inputSchema(project_path?/file_path/content);execute 从 context.requestContext 读 projectDir → `resolveProjectDir` 校验(比对 realpath)→ node:fs 操作(readdir 浅层/readFile ≤30 万字符/writeFile 建父目录);未激活或未注册 → 返回提示文本
2. agent.ts tools 注册 project_list_files/project_read_file/project_write_file;instructions 增补:项目任务优先用项目工具;无项目时提示先选择

**验证:** curl chat:带 requestContext{projectDir:注册目录} 发"列出项目文件" → 返回真实目录内容;带未注册目录 → 返回拒绝;不带 projectDir → 返回"先选择项目"

## T3: Electron 目录选择 + 新建项目弹窗 + 侧栏分组

**文件:** `app-desktop/preload.js`、`app-desktop/main.js`、`app-desktop/package.json`、`ProjectModal.tsx`、`Sidebar.tsx`、`taskStore.ts`、`projectsClient.ts`、样式
**依赖:** T1
**步骤:**
1. preload:contextBridge.exposeInMainWorld('jlcDesktop', { selectDirectory: () => ipcRenderer.invoke('select-directory') });main:ipcMain.handle('select-directory', () => dialog.showOpenDialog({properties:['openDirectory']}) 返回路径或 null);package.json main 进程 preload 指向
2. projectsClient:list/create/remove/link/getLinks + selectDirectory()(window.jlcDesktop 桥;浏览器返回 null)
   - 新增 lib/desktop.ts:isDesktop 检测(window.jlcDesktop 存在性)
3. ProjectModal:名称 input + 目录(桌面:选择文件夹按钮显示所选路径;浏览器:path 输入框)+ 取消/创建
4. Sidebar:「项目」section(**仅 isDesktop 时渲染**;列表 + [+ 新建]→ProjectModal)+ 点击项目 → taskStore.selectedProject(再点取消);最近任务按 selectedProject 过滤
5. taskStore:selectedProject 状态 + links 数据

**验证:** 桌面壳:新建项目(原生选目录)→ 侧栏项目出现 → 点击筛选;浏览器:项目入口不出现

## T4: 首页项目选择器 + TaskPage 注入与绑定

**文件:** `HomePage.tsx`、`TaskInput.tsx`、`TaskPage.tsx`
**依赖:** T2、T3
**步骤:**
1. HomePage:输入框上方"当前项目"下拉(无项目/项目列表,存 selectedProject);提交时 navigate state 携带 {project}
2. TaskPage:读 state.project → requestContext 注入 {model, projectDir, projectName}(transport getModel 同模式扩为 getRequestContext);首次 loadMessages 后若线程无消息且带 project → POST /projects/link
3. 附带:首页提交时刷新项目下任务(侧栏已由 T3 覆盖)

**验证:** 桌面壳首页选「我的网站」发"看看项目里有什么文件" → agent 列出真实目录(项目选择器仅桌面渲染)

## T5: 按 checklist 验收

**文件:** `docs/spec/h0-checklist.md`(阶段四生成)
**依赖:** T4
**步骤:** 阶段六执行:逐项运行 checklist(AC1~AC8),记录证据,出验收报告

## 执行顺序

```
T1 → T2 → T3 → T4 → T5
```
