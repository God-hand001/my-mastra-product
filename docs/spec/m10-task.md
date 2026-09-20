# M10 扩展体系 Tasks

> 前置:[m10-spec.md](./m10-spec.md)、[m10-plan.md](./m10-plan.md) 已确认
> 通用约束:中文注释;每个任务的验证输出贴进完成报告;不复制 WorkBuddy(腾讯)技能/脚本内容,内容来源按 spec「内容来源策略」;`extensions-local/` 不进 git。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `scripts/setup-extensions.mjs` | 内置扩展内容一键引入 |
| 新建 | `extensions/skills/…`、`extensions/connectors/…` | 内置内容(≥20 技能、≥8 连接器) |
| 修改 | `.gitignore` | 忽略 `extensions-local/` |
| 新建 | `src/mastra/services/extension-store.ts` | 扫描/登记/状态/导入 |
| 新建 | `src/mastra/services/connector-runtime.ts` | MCP stdio 客户端与工具并入 |
| 新建 | `src/mastra/server/extension-routes.ts` | REST |
| 修改 | `src/mastra/agents/agent.ts` | skills resolver + MCP 工具 + 指令 |
| 修改 | `src/mastra/index.ts`、`package.json` | 路由注册、@mastra/mcp 依赖 |
| 新建 | `app/src/routes/ExtensionsPage.tsx` | 扩展面板 |
| 修改 | `app/src/components/Sidebar.tsx`、`app/src/App.tsx` | 激活入口与路由 |
| 修改 | `app/src/components/TaskInput.tsx`、`ChatThread.tsx` | 技能选择器(激活占位按钮) |

---

## T1: 技术前提验证(先行,结论写回 plan)

**产���:** `docs/spec/m10-plan.md` 附录「T1 验证结论」+ 可运行的最小示例代码片段(不进主代码)
**依赖:** 无

**步骤:**
1. `npm i @mastra/mcp`;读其 d.ts/README:确认 `MCPClient` 构造(stdio servers 配置)、工具获取(`getTools()` 或等价)、工具命名形态、超时/错误语义。
2. 验证 Agent `tools` 是否接受函数(动态)——读 `@mastra/core` agent.d.ts 构造参数;不支持则确认「toggle 后重建 Agent 实例」的可行做法(Mastra 单例注册表的更新方式)。
3. 验证 `Workspace({ skills })` 动态 resolver:skills 传函数时 requestContext 是否透传、清单注入格式、`skill`/`skill_read` 工具是否自动出现(用 `agent.listSkills()` + 一次真实调用观察)。
4. 用一个最小 SKILL.md 目录(手写 hello-world)走通:发现→注入→agent 调用。

**验证:** 四项结论各自有代码证据(类型定义摘录或运行输出),写进 plan 附录;发现与 plan 假设不符处同步修订 plan。

---

## T2: 扩展内容引入

**文件:** `scripts/setup-extensions.mjs`(新建)、`.gitignore`(修改)
**依赖:** T1

**步骤:**
1. 脚本幂等:存在即跳过。下载 anthropics/skills(GitHub)选定技能子集(目标 ≥17 个:docx/pdf/pptx/xlsx/artifacts-builder/webapp-testing/mcp-builder/skill-creator 等,以仓库实际清单为准)到 `extensions/skills/<name>/`;每个技能目录附 `SOURCE.md`(上游 URL+commit+License)。
2. 自写 3 个技能:①`jlc-order-guide`(嘉立创下单流程,内容自拟中文)②`eda-basics`(EDA 常识)③`word-html-spec`(把 M7 agent.ts 里 Word 生成规范改造成技能,agents 指令中留一行指向该技能)。
3. 生成 8 个 `connectors/<name>/connector.json`:everything、filesystem、fetch、memory、sequential-thinking、time、git、sqlite(官方 @modelcontextprotocol 包;args 里用 `${ROOT}` 占位;sqlite 指向 workspace 下示例库)。
4. `.gitignore` 加 `extensions-local/`。

**验证:** `node scripts/setup-extensions.mjs` 后 `extensions/skills` ≥20 个含 SKILL.md 的目录、`extensions/connectors` ≥8 个 connector.json;`node -e` 抽查 3 个 JSON 可解析;二次执行跳过不重下。

---

## T3: 扩展登记与状态服务

**文件:** `src/mastra/services/extension-store.ts`(新建)
**依赖:** T2

**步骤:**
1. 扫描 `extensions/` 与 `extensions-local/`:技能=含 SKILL.md 的目录(name 取 frontmatter 的 name,目录名兜底);连接器=含 connector.json 的目录(JSON 解析失败记为 invalid,不抛)。
2. registry 读写(`storage/extensions-registry.json`,缺省=启用);`listExtensions()` 返回 `{ skills: [{name, description, source: builtin|local, enabled, dir}], connectors: [{name, description, config, enabled, lastError, invalid}] }`。
3. `toggle(kind, name)`、`importSkill(dir)` / `importConnector(dir)`(校验 SKILL.md/connector.json 存在→拷贝到 extensions-local→登记,重名报错)。
4. `enabledSkillDirs(requestContext)`:启用技能的绝对路径数组;`requestContext.skill` 存在时把该技能置首并强制包含。

**验证:** 临时脚本调用:列表数量正确;toggle 后 registry 变化;导入一个手写最小技能成功且出现在列表;非法目录报 invalid 不抛异常。

---

## T4: 连接器运行时

**文件:** `src/mastra/services/connector-runtime.ts`(新建)、`package.json`(若 T1 未装 @mastra/mcp)
**依赖:** T1、T3

**步骤:**
1. 按启用连接器构造 MCP 客户端(stdio;`${ROOT}` 替换为 workspace 根 `src/mastra/public/workspace` 的绝对路径);每个连接器 60s 启动超时,失败捕获:记 `lastError`(命令不存在/超时/退出),不抛出、不影响其他连接器。
2. 暴露 `getMcpTools()`(全部成功连接器的工具合并)与 `refresh()`(toggle 后重建客户端)。
3. 后端进程退出时清理子进程。

**验证:** 临时脚本:启用 filesystem 连接器 → getMcpTools 含其工具且能真实列目录;把一个 connector.json 的 command 改成不存在文件 → lastError 有中文原因、其他工具仍在;恢复后正常。

---

## T5: REST 路由

**文件:** `src/mastra/server/extension-routes.ts`(新建)、`src/mastra/index.ts`(修改)
**依赖:** T3、T4

**步骤:**
1. `GET /extensions`(列表)、`GET /extensions/skills/:name`(SKILL.md 原文+路径)、`POST /extensions/:kind/:name/toggle`(skill 走 registry;connector 走 registry+refresh)、`POST /extensions/import`(body `{ localPath }`,复用项目目录的安全校验思路限定在用户选择目录,拷贝导入)。
2. 参照既有 route 文件(drive-routes 等)的写法注册进 apiRoutes;`npx tsc --noEmit` 通过。

**验证:** curl 逐个打接口,输出贴报告:列表含两类与状态;toggle 生效;导入返回成功并能列出;非法路径返回中文错误。

---

## T6: agent 接线

**文件:** `src/mastra/agents/agent.ts`(修改)
**依赖:** T3、T4

**步骤:**
1. Workspace 增加 `skills: (ctx) => enabledSkillDirs(ctx?.requestContext)`(plan T1 结论的最终形态)。
2. agent 工具并入 `getMcpTools()` 结果(按 T1 结论的动态/重建方案落地,注明选择理由)。
3. instructions 增补「扩展使用规范」:任务可能命中技能清单时先用 skill 工具查看;连接器工具按其描述真实调用;不臆造未列出的工具名。
4. 手动指定:按 plan 的两案选定落地(requestContext.skill → resolver 置首 + 系统注入一行"用户明确要求使用技能 X";若 processor 方案更稳则用之),并保证禁用态技能被手动指定时临时可用。

**验证:** 根 `npx tsc --noEmit` 通过;重启后端,`agent.listSkills()` 数量 ≥20;一次真实对话让 agent 对"做一份 PPT 大纲"自动调用 skill 工具(流日志贴报告)。

---

## T7: 扩展面板

**文件:** `app/src/routes/ExtensionsPage.tsx`(新建)、`app/src/components/Sidebar.tsx`、`app/src/App.tsx`(修改)
**依���:** T5

**步骤:**
1. Sidebar「扩展」按钮去 `sidebar-nav-disabled`,跳 `/extensions`;App.tsx 注册路由。
2. 页面:顶部两标签(技能/连接器);卡片流(名称/描述/来源徽标/启用开关,复用全站既有样式令牌);连接器卡加状态点(已连接/失败)+失败原因;点卡片开详情抽屉——技能用 MarkdownText 渲染 SKILL.md,连接器展示 command/args/env(脱敏无敏感值)。
3. 「导入本地扩展」按钮:Electron `select-directory` 桥(H0 已有)→ POST import → 刷新列表;非桌面端隐藏该按钮。

**验证:** `cd app && npx tsc --noEmit` 与 `npm run build` 通过;面板实测:开关切换即时反映、详情正确渲染、导入手写技能成功。

---

## T8: 输入框技能选择器

**文件:** `app/src/components/TaskInput.tsx`、`app/src/components/ChatThread.tsx`(修改)
**依赖:** T5、T7

**步骤:**
1. 激活两处占位「技能」按钮:点击弹出轻量浮层(启用技能列表,搜索框过滤,点击选中)。
2. 选中后:输入框旁显示技能标签(名称+可移除 ×);发送时 requestContext 携带 `skill`(transport.ts 既有 getRequestContext 通道,参照 model 的接法);发送后标签清除;一次只带一个技能(再选即替换)。
3. 空态:无启用技能时按钮置灰并提示。

**验证:** `cd app && npx tsc --noEmit` 与 `npm run build` 通过;两处入口实测:选技能发送,后端流日志可见 requestContext.skill,回复体现技能生效(AC3)。

---

## T9: 端到端验证与验收

**依赖:** T6–T8
**步骤:** 对照 `m10-checklist.md` 逐项执行 A/C 组;重点场景:自动命中技能(AC2)、手动指定(AC3)、连接器真实调用(AC4)、坏连接器隔离(AC5)、导入自写扩展(AC6)、重启状态保持(AC7)、M7/浏览器回归(AC8)。
**验证:** checklist 勾选记录 + 全流程报告。

---

## 执行顺序

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9

T1 结论回写 plan 后才准开 T4/T6;T2 与 T3 可并行准备;T7/T8 依赖 T5 接口定型。
