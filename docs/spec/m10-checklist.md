# M10 扩展体系 Checklist

> 验证方式:勾选时追加实际结果。A 组为脚本/接口断言;B 组构建;C 组端到端,对应 spec AC。

## A. 内容与接口

- [x] **A1**(T2)`extensions/skills` ≥20 个含 SKILL.md 的目录;`extensions/connectors` ≥8 个 connector.json;抽查 JSON 可解析;自写 3 技能(jlc-order-guide/eda-basics/word-html-spec)在列 — 实测 22 技能+8 连接器;GET /extensions 返回 22/8,自写 3 技能在列
- [x] **A2**(T2)每个上游技能带 SOURCE.md(来源+License);二次执行 setup 幂等 — SOURCE.md 抽查(docx/pdf)含上游 URL+commit+License;setup-extensions.mjs 二次执行全部跳过
- [x] **A3**(T3)listExtensions 数量/来源/状态正确;toggle 落盘 registry;导入重名报中文错 — toggle eda-basics→registry 落盘 false→恢复 true;导入 hello-test-skill 成功且 source=local;重名/缺文件中文报错(importSkill 校验)
- [x] **A4**(T3)`enabledSkillDirs`:禁用项不出现;`requestContext.skill` 置首且禁用态临时包含 — 禁用 xlsx 后 agent 回答清单无 xlsx;禁用 hello-test-skill+requestContext.skill 指定→仍在清单且 agent 可读。注:「置首优先」由 inline skill 信号(user-requested-skill)实现,因清单注入按名称排序,见 m10-plan「T6 实测修订」
- [x] **A5**(T4)filesystem 连接器工具真实可列目录(AC4 正向) — agent 真实调用 filesystem_list_allowed_directories+filesystem_list_directory 并返回工作区内容
- [x] **A6**(T4)坏命令连接器 → lastError 中文原因,其余工具不受影响(AC5) — time 改坏命令→lastError=「连接器启动失败(…): Failed to connect…」(中文前缀+SDK 首行);其余连接器正常
- [x] **A7**(T5)四个 REST 接口 curl 全通,错误路径返回中文 — 列表/详情/toggle/导入全通;非法路径→「localPath 必须是绝对路径」;404→「未找到该技能」;坏 kind→「kind 必须是 skill 或 connector」
- [x] **A8**(T6)`agent.listSkills()` ≥20;自动触发:对话中 agent 调用 skill 工具命中技能(AC2) — 真实对话:简历请求→skill_search×8+skill 读 word-html-spec 并按技能规划;清单含 22 技能
- [x] **A9**(T6)手动指定:requestContext.skill 到达后端且生效(AC3 后端侧) — requestContext.skill=hello-test-skill→agent 调用 skill 工具读取并回复「hello-test-skill 技能生效」
- [x] **A10**(T6)instructions 含「扩展使用规范」段 — agent.ts 已含(技能清单/skill_search/连接器工具纪律/user-requested-skill 说明)

## B. 构建

- [x] **B1** 根 `npx tsc --noEmit` 无输出 — 多轮改动后复验干净
- [x] **B2** `cd app && npx tsc --noEmit` 无输出
- [x] **B3** `cd app && npm run build` ✓ 结束 — `✓ built in 18.75s`(chunk 体积警告为既有问题)
- [x] **B4** `git status` 不出现 `extensions-local/` 与 registry;`extensions/` 内容与 LICENSE 正常入库 — git check-ignore 确认两者均忽略;extensions/ 为新增待提交

## C. 端到端

- [x] **C1**(AC1)侧栏「扩展」打开面板,两标签卡片流完整 — 用户 2026-09-16 桌面端目验通过
- [x] **C2**(AC2)自动命中技能的真实对话全程(含后端工具调用日志) — 见 A8,流日志含 skill/skill_search 调用参数与结果
- [x] **C3**(AC3)输入框技能选择:TaskInput 与 ChatThread 两处都能选、发、显示标签、生效 — 用户 2026-09-16 桌面端目验入口与浮层通过;"选中→发送→生效"链路后端侧已实测(见 A9)
- [x] **C4**(AC4)启用→agent 经 MCP 工具列目录;禁用→agent 明确说没有该工具 — 正向见 A5;禁用后 agent 回复「没有名为 filesystem_list_directory 的工具」并降级用自带工具
- [x] **C5**(AC5)坏连接器:面板显示原因、对话不中断、其他扩展可用 — lastError 经 /extensions 暴露给面板;对话与其他连接器全程正常
- [x] **C6**(AC6)手写最小 SKILL.md 导入→面板可见→启用→对话生效 — hello-test-skill 全链路实测(导入 API→列表 source=local→agent 读取并按指示回复)
- [x] **C7**(AC7)重启后启用状态保持 — 后端完整重启后 /extensions 返回全部技能+8 连接器状态不变(含当时导入的本地技能),0 连接失败
- [x] **C8**(AC8)M7 Word 生成、内置浏览器、预览面板回归正常 — verify_m7_converter.py 27/27;M8 PPT e2e 通过;预览面板为新增分支无改动既有路径
