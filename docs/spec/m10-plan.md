# M10 扩展体系 Plan

> 前置:[m10-spec.md](./m10-spec.md) 已确认
> 技术栈:Mastra(后端,原生 Workspace Skills + @mastra/mcp)+ React/Electron(前端)

## 架构概览

技能侧**站在 Mastra 原生能力上**(core 1.64 按 anthropics/skills 规范内置:`Workspace({ skills })` 发现 SKILL.md、清单注入系统提示、自动挂 `skill`/`skill_search`/`skill_read` 工具、动态路径解析),自研部分收敛为:扩展目录与登记、连接器(MCP)运行时、REST、前端面板与输入框入口。

```
extensions/                      # 内置扩展(进 git,含各上游 LICENSE)
├── skills/<name>/SKILL.md…      # ≥20(anthropics/skills 子集 + 自写)
└── connectors/<name>/connector.json  # ≥8(官方开源 MCP server)
extensions-local/                # 本地导入(gitignore)
storage/extensions-registry.json # 用户启用状态(gitignore,storage/ 已忽略)
```

## 核心数据结构

### connector.json(简化自 WorkBuddy plugin.json 的 mcpServers 段)

```jsonc
{
  "name": "filesystem",
  "description": "读写本地文件系统的 MCP 服务器",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT}"],  // ${ROOT}=workspace 根
  "env": {}
}
```

### 登记文件(storage/extensions-registry.json)

```jsonc
{
  "skills": { "docx": true, "pdf": false },
  "connectors": { "filesystem": { "enabled": true, "lastError": null } }
}
```

### Mastra 侧挂接

```ts
// src/mastra/agents/agent.ts 的 Workspace 配置扩展:
const workspace = new Workspace({
  /* …既有 filesystem/sandbox… */
  skills: (ctx) => resolveEnabledSkillDirs(ctx?.requestContext),  // 动态解析:只返回启用技能目录(含手动指定优先)
});
```

原生行为(不重复实现):清单注入系统提示(名称+描述)→ agent 用 `skill`/`skill_read` 工具按需读全文;`agent.listSkills()` 供 REST 列表复用。

## 模块设计

### 模块 A:扩展内容引入(scripts/setup-extensions.mjs)

**职责**:一键拉取/更新内置扩展内容。下载 anthropics/skills 选定子集(保留其 LICENSE 与来源 README)到 `extensions/skills/`;自写技能(嘉立创下单、EDA 常识、Word 生成规范)手写入库;生成 8 个 `connectors/*/connector.json`。已存在则跳过(幂等)。
**依赖**:无(网络仅首次)。

### 模块 B:扩展登记与状态(services/extension-store.ts)

**职责**:扫描 `extensions/` 与 `extensions-local/`(技能=含 SKILL.md 的目录;连接器=含 connector.json 的目录);读写 registry(缺省条目视为启用);提供 enabled 过滤后的技能目录数组(供动态 resolver);导入接口(拷贝到 extensions-local)。
**注意**:SKILL.md frontmatter 由 Mastra 解析,这里只做"目录发现 + 状态管理",不重复解析。

### 模块 C:连接器运行时(services/connector-runtime.ts)

**职责**:安装 `@mastra/mcp`;按 registry 启用项构造 `MCPClient`(stdio,`${ROOT}` 占位符替换为 workspace 根);暴露 `getTools()` 结果并挂到 agent;单连接器启动失败捕获记入 `lastError`(60s 超时),不拖垮其他;toggle 时重建客户端。
**待实现时验证**:①`@mastra/mcp` 当前版本与 `MCPClient` API 形态(getTools/工具命名空间);②Agent `tools` 是否支持动态函数——不支持则在 toggle 后重建 agent 实例(mastra dev 本就热重建,生产态重启服务)。

### 模块 D:agent 接线(agents/agent.ts)

**改动**:Workspace 加动态 `skills` resolver(经模块 B 过滤);启动时并入模块 C 的 MCP 工具;instructions 增补一段「扩展使用规范」——任务可能命中技能时先用 skill 工具查看,命中连接器工具直接使用,不要臆造工具名。
**手动指定(F3)**:`requestContext.skill = <name>` 时,动态 resolver 把该技能目录置于首位并保证包含(若被禁用则临时包含);同时该消息系统注入一行「用户明确要求使用技能 X」。(实现备选:input processor 注入 SKILL.md 全文——实现时按 Mastra processor 可用性二选一,T6 验证)

### 模块 E:REST(server/extension-routes.ts)

`GET /extensions`(两类列表+状态+lastError)、`GET /extensions/skills/:name`(SKILL.md 原文)、`POST /extensions/:kind/:name/toggle`、`POST /extensions/import`(body: 本地路径,校验含 SKILL.md/connector.json 后拷贝登记)。
**依赖**:模块 B、C。

### 模块 F:前端扩展面板(routes/ExtensionsPage.tsx + Sidebar 激活)

**改动**:Sidebar「扩展」按钮去禁用态 → `/extensions`;页面两标签卡片流(复用既有卡片/开关样式体系);详情抽屉用 MarkdownText 渲染 SKILL.md;「导入本地扩展」走 `select-directory` IPC 桥(H0 已有);连接器卡显示 lastError。
**依赖**:模块 E。

### 模块 G:输入框技能选择器(TaskInput.tsx / ChatThread.tsx)

**改动**:激活两处占位「技能」按钮:弹层列启用技能(拉 `/extensions`),选中后本条消息携带 `requestContext.skill`;发送按钮旁显示技能标签,可移除;随消息发送(参照 model/projectDir 的 requestContext 携带方式,transport.ts 已支持)。
**依赖**:模块 E、D。

## 模块交互

```
自动路径:用户发消息 → Workspace skills resolver(过滤启用) → Mastra 注入技能清单 →
  agent 判定命中 → 调 skill 工具读全文 → 按 references 执行 → 回复
手动路径:点「技能」→ 选 docx → 发送(requestContext.skill=docx) → resolver 优先包含 →
  系统注入「用户要求用技能 X」 → agent 加载并遵循
连接器:面板启用 filesystem → POST toggle → connector-runtime 起 stdio server →
  MCP 工具并入 agent → 对话中出现并真实调用;失败 → lastError 显示于卡片
导入:选文件夹 → 校验 → 拷入 extensions-local → registry 登记 → 面板刷新
```

## 文件组织

```
scripts/setup-extensions.mjs            → 新建:内容引入
extensions/skills/…  extensions/connectors/…  → 生成(进 git)
extensions-local/                       → 本地导入(gitignore)
src/mastra/services/extension-store.ts  → 新建
src/mastra/services/connector-runtime.ts→ 新建
src/mastra/server/extension-routes.ts   → 新建
src/mastra/agents/agent.ts              → 修改:skills resolver + MCP 工具 + 指令
src/mastra/index.ts                     → 修改:注册路由
app/src/routes/ExtensionsPage.tsx       → 新建
app/src/components/Sidebar.tsx          → 修改:激活入口
app/src/components/TaskInput.tsx / ChatThread.tsx → 修改:技能选择器
app/src/App.tsx                         → 修改:路由
package.json                            → 修改:@mastra/mcp 依赖
.gitignore                              → 修改:extensions-local/
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 技能加载 | Mastra 原生 Workspace Skills | core 已按 anthropics/skills 规范内置(发现/注入/工具/动态解析),自研重复造轮子 |
| 技能内容 | anthropics/skills 开源集 + 自写 | 满足"几十个";WorkBuddy 内容是腾讯内部材料且绑定其服务,不复制(spec 内容来源策略) |
| 连接器形态 | MCP stdio + connector.json | 与 WorkBuddy mcpServers 同构;官方开源 server 现成可用 |
| 状态存储 | storage/ 下 JSON | 与项目存储同目录,免新依赖 |
| 启用过滤 | 动态 skills resolver | Mastra 原生支持 requestContext 函数式解析,禁用即不进清单 |
| 手动指定 | requestContext.skill + resolver 优先 | 复用既有 requestContext 通道(与 model/projectDir 同路) |
| 连接器失败 | 捕获记 lastError,不阻塞 | N4:单扩展坏了不影响产品 |
| 伙伴/市场卡 | 不做(spec) | 用户确认缓一档;本地导入覆盖学习目的 |

## 待实现时验证的技术细节(T1 专项)

1. `@mastra/mcp` 版本与 `MCPClient` API(stdio 配置、getTools、工具命名、错误语义)。
2. Agent `tools` 动态性:不支持函数则 toggle 后重建 agent(记录到实现注释)。
3. Workspace `skills` 动态 resolver 的触发时机与 requestContext 透传(手动指定依赖它)。
4. 手动指定的系统注入通道:resolver 方案 vs input processor 方案,二选一落地。
5. npx 在沙箱 execute_command 之外由后端直接 spawn 的可行性(N4:不进 agent 沙箱)。

## T1 验证结论(2026-09-15,已定案)

1. **@mastra/mcp@1.17.3**:`new MCPClient({ servers: { <名>: { command, args, env } }, timeout })` 即 stdio 配置,与 connector.json 直接对应;`await mcp.listTools()` 返回扁平 `Record<string, Tool>`(带命名空间),`listToolsets()` 按服务器分组,且存在"同时返回失败服务器错误"的变体(实现时用带错误版,失败原因落 lastError);`mcp.disconnect()` 清理子进程。官方示例即 `tools: await mcp.listTools()` 传给 Agent。
2. **Agent tools 支持异步动态**:`tools: DynamicArgument<TTools, TRequestContext>` = `T | (({ requestContext, mastra }) => Promise<T> | T)`(dist/types/dynamic-argument.d.ts)。→ **采用动态 tools 函数** `tools: async ({ requestContext }) => ({ ...静态, ...(await connectorRuntime.getMcpTools()) })`,toggle 后 refresh 即生效,**无需重建 Agent**。
3. **Workspace skills 动态 resolver 类型确认**:`skills?: SkillsResolver`(`workspace.d.ts:295`),函数形态 `(ctx) => string[] | Promise<string[]>`,ctx 含 requestContext;技能工具(skill/skill_search/skill_read)在配置 skills 后自动挂载(agent.d.ts:979)。运行时行为在 T6 真实对话最终确认。
4. **手动指定通道**:resolver 函数内读取 `requestContext.skill` 置首并强制包含(类型已支持透传);配套在 instructions 注明。input processor 方案弃用(多一层机制,无必要)。
5. **npx spawn**:MCPClient 内部自行拉起 stdio server(后端进程直启),不经 agent 沙箱,无障碍。

## T6 实测修订(2026-09-15 夜,与 T1 假设不符处,以本节为准)

1. **技能 resolver 必须挂 Agent 级,不能挂 Workspace 级**:Workspace 级 `skills` 的路径解析走 workspace 文件系统(沙箱限定在 `src/mastra/public/workspace` 内),仓库根下 `extensions/` 的绝对路径全部被 "path is outside the workspace" 拒绝,清单为空。Agent 级 `skills`(同样支持 `({ requestContext }) => string[]` 动态 resolver)用 `process.cwd()` 基准的 `LocalSkillSource`,绝对路径可用。已改挂 agent.ts。
2. **技能清单注入系统提示时按名称排序**(prompt cache 稳定性,`formatAvailableSkills` 注释明示),resolver 返回顺序不体现优先级 → "手动指定置首"无效。改为:resolver 在 `requestContext.skill` 存在时追加一条 inline skill(`createSkill`,name=user-requested-skill),description/instructions 明确告知用户指定的技能名,agent 据此优先读取该技能。实测通过(含禁用态强制包含)。
3. **连接器官方 Python 服务器**:npm 上不存在 `@modelcontextprotocol/server-{fetch,git,sqlite,time}`(404,这四个官方实现是 Python 包)。改用 `${PY}` 占位符 → `vendor/python/python.exe -m mcp_server_{fetch,time,git}`、sqlite 以 `python -c "import sys; from mcp_server_sqlite import main; main()"` 启动(该包无 `__main__`);4 个包加入 setup-python-runtime.mjs OPT_DEPS。`${PY}` 替换在 connector-runtime.ts 实现(command 与 args 都过占位符)。sqlite 示例库 `workspace/data/sample.sqlite` 需预建(setup-extensions.mjs 生成配置,首次建库脚本见验证报告)。
4. **lastError 中文化**:SDK 报错为英文长堆栈,connector-runtime 统一加中文前缀并取首行截断,面板直接可读。
