# M10 扩展体系(技能+连接器) Spec

> 产品:类千问办公的任务型 AI 助手(嘉立创办公,基于 Mastra harness)
> 编号:M8(pptx)/M9(xlsx) 为路线图预留,本次取 **M10**;伙伴(专家)缓一档放 **M11**
> 调研对象:WorkBuddy 桌面端扩展体系(E:\soft\WorkBuddy 反编译分析)

## 背景

产品当前的能力全部硬编码在 agent 里(工具/instructions 写死),用户无法扩充。参考产品 WorkBuddy 的扩展体系建立在 CodeBuddy 插件格式上(与 Claude Code 插件/Agent Skills 规范同构):

- **技能** = `skills/<name>/SKILL.md`(YAML frontmatter + 指令正文 + references/ + scripts/),agent 上下文常驻技能清单,干活时才读具体参考文件(渐进式加载)
- **连接器** = 插件清单里的 `mcpServers`(本地 stdio 或远程 MCP 服务器),装好后 MCP 工具直接进 agent 工具列表
- **伙伴** = `agents/*.md` 子代理定义(M11 再做)
- 一个 marketplace 清单统一登记,agent 在任务缺外部工具时可通过宿主工具弹"连接器推荐卡"(本模块不做)

**关键现状(决定架构)**:Mastra core 1.64 **原生支持 Agent Skills**(注明遵循 github.com/anthropics/skills 规范)——`Workspace({ skills })` 支持 SKILL.md 目录发现、系统提示注入(清单)、自动挂 `skill`/`skill_search`/`skill_read` 工具、按请求动态解析路径(requestContext)。技能侧无需自研加载器,主要工作在连接器(MCP)与产品化 UI。

## 内容来源策略(先行声明,须用户确认)

用户要求"直接拿 WorkBuddy 的来用,几十个总要有"。**格式直接采纳**(SKILL.md/connector.json 与 WorkBuddy 同构);**内容不整包复制**——WorkBuddy 技能正文是腾讯内部材料(其 SKILL.md 标注 `license: Internal`)且大量绑定 docs.qq.com 账号服务,本地产品用不了。满足"几十个"的合规来源:

1. **anthropics/skills 开源技能集**(GitHub,WorkBuddy 技能格式的上游规范,License 引入时随包保留):文档类(docx/pdf/pptx/xlsx)、artifacts-builder、webapp-testing、mcp-builder、skill-creator 等约 20 个
2. **modelcontextprotocol/servers 官方开源 MCP 服务器**:everything、filesystem、fetch、memory、sequential-thinking、time、git、sqlite 等(npx 直接运行,选无需付费 API key 的 8 个)
3. **自写技能 2-3 个**:嘉立创下单流程、EDA 常识、Word 生成规范(复用 M7 的 HTML 约定,把 instructions 里那段改造成技能)

## 目标

- G1:左侧栏「扩展」入口激活,提供技能/连接器的统一管理面板
- G2:技能从目录自动发现并注入对话,agent 可自动按需调用;输入框「技能」按钮(占位已有)可手动指定
- G3:连接器(MCP stdio)启用后其工具进入对话,agent 可真实调用
- G4:扩展内容开箱自带几十个(技能 ≥20、连接器 ≥8),支持从本地文件夹导入自写扩展
- G5:启用/禁用即时生效,不需要重启产品

## 功能需求

- **F1 扩展面板**:左侧栏「扩展」打开面板;两个标签(技能/连接器);卡片显示名称/描述/来源/启用开关;点击看详情(SKILL.md 渲染;连接器显示命令与工具数)
- **F2 技能自动注入**:启用的技能清单随对话注入 agent(名称+描述);agent 判断任务命中时通过技能工具读取全文执行(渐进式)
- **F3 技能手动指定**:输入框「技能」按钮弹层列出启用技能,选中后本条消息优先使用该技能(发送后输入区显示技能标签);TaskInput 与 ChatThread 两处入口
- **F4 连接器接入**:启用连接器时后端启动其 MCP stdio 服务器,工具并入 agent;禁用即断开;启动失败显示明确原因(命令不存在/超时),不影响其他扩展
- **F5 本地导入**:面板「导入本地扩展」选文件夹(含 SKILL.md 或 connector.json),拷入本地扩展目录并登记
- **F6 状态持久**:启用/禁用状态落盘,重启保持
- **F7 自检可诊断**:连接器启动失败/技能格式非法时,面板显示具体原因;后端日志可查

## 非功能需求

- **N1 离线可用**:已安装/启用的扩展在不联网时照常工作(连接器 npx 首次运行需网,拉取后离线可用)
- **N2 隔离**:扩展内容只读挂载,不污染产品代码;本地导入与内置分目录
- **N3 安全**:连接器命令来自本地扩展目录(非远程下发);技能内容进上下文但不含可执行授权
- **N4 性能**:技能清单注入不显著增加 token(只含名称+描述);连接器懒启动失败不阻塞对话
- **N5 不回退现有功能**:M6 浏览器/M7 Word 生成/预览/产物链路不受影响

## 不做的事

- **伙伴(专家/子代理)** → M11(用户已确认一期不做)
- **连接器市场/在线安装/推荐卡片**(search_plugins/suggest_plugin_install)→ 二期,本地导入已覆盖学习目的
- **远程 MCP(需 OAuth/鉴权流)** → 一期只做 stdio 本地服务器
- **skill_search 向量检索** → 用 Mastra 默认(若含),不额外建索引管线
- 不复制 WorkBuddy 技能/连接器的腾讯内容(见内容来源策略)

## 验收标准

- **AC1**(F1):侧栏「扩展」可打开面板,列出 ≥20 技能与 ≥8 连接器,开关可切换
- **AC2**(F2):不指定技能让 agent「做一份 PPT 大纲」类任务,观察其调用 skill 工具命中对应技能并按 references 执行(后端日志可见)
- **AC3**(F3):输入框点「技能」选一个技能后发送,该条消息的回复体现技能指令生效(如格式/结构符合技能规定),输入区显示技能标签
- **AC4**(F4):启用 filesystem 连接器后,agent 能通过其工具列出指定目录;禁用后同一问题 agent 报告无此工具
- **AC5**(F4):把一个连接器命令改成不存在的可执行文件,启用后面板显示失败原因,对话不中断,其他扩展可用
- **AC6**(F5):手写一个最小 SKILL.md 文件夹导入后出现在面板并可启用生效
- **AC7**(F6):禁用若干扩展后重启产品,状态保持
- **AC8**(N5):M7 Word 生成、内置浏览器、预览面板回归正常
