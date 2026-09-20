# 夜间执行计划(2026-09-15 晚,用户不在,自主推进 M10/M8/M9)

> 目标:明早用户回来看到三个里程碑的验收结果。本文件是进度台账,随做随更。

## 分工与冲突规避

- 共享文件(agent.ts / index.ts / setup-python-runtime.mjs / app.css)**全部由 Claude 编辑**,codex 任务书里明确禁止碰这些文件,避免并发写冲突。
- codex 派发:`codex exec --skip-git-repo-check --sandbox workspace-write "<任务书>" < /dev/null 2>&1` 后台运行(stdin 必须重定向,否则挂在 Reading additional input)。

## 顺序

1. [Claude] setup-python-runtime.mjs:加 python-pptx/openpyxl/formulas;拷贝 glob 覆盖 html_to_pptx/xlsx_recalc(容忍目录未建);跑一次装依赖。
2. [Claude] agent.ts:M10 T6(skills resolver + MCP tools 动态合并 + 扩展使用规范)+ M8「PPT 生成规范」+ M9 一行规范,一次编辑完成。
3. [Claude→codex] 派 codex 做 M8:T1(验证 import pptx)→T2 layout/element_map →T3 decorations/images →T4 仅 html-to-pptx.ts 工具文件(不碰 agent/index)→T5 pptx-preview 预览 →T6 verify_m8_pptx.py 断言脚本。
4. [Claude 并行] M10 T7(ExtensionsPage.tsx + Sidebar 激活 + App 路由,样式放独立 extensions.css 避免碰 app.css)→ T8(TaskInput/ChatThread 技能选择器)。
5. [Claude] M10 T6 验证:重启后端 agent.listSkills() ≥20 + 真实对话技能命中。
6. [Claude] codex M8 产出 review:跑 verify_m8_pptx.py、注册工具、tsc、app 构建、pptx 预览实测、M8 checklist A/B 组。
7. [Claude→codex] 派 codex 做 M9:T1 formulas spike(结论回写 m9-plan)→T2 xlsx_recalc →T3 仅 xlsx-build.ts 工具文件(不碰 agent/index)→T4 excel-generation 技能(自研中文)→T5 verify_m9_xlsx.py。
8. [Claude 并行] M8 C 组端到端(真实对话 5 页 PPT)+ M10 C 组端到端。
9. [Claude] codex M9 review:跑 verify_m9_xlsx.py、注册 xlsx-build、M9 端到端(月度开支表两 sheet)、M7 回归(verify_m7_converter.py)。
10. [Claude] 三份 checklist 勾验 + 验收报告(docs/spec/overnight-report-20260916.md)+ 记忆更新。

## 状态记录

- [x] 步骤1 setup 脚本扩展(pptx/openpyxl/formulas 装齐,冒烟 ok)
- [x] 步骤2 agent.ts 接线(skills resolver→Agent 级/动态 MCP tools/扩展规范+PPT 规范+xlsx 一行);index.ts 连接器预热
- [x] 步骤3 codex M8 完成:28/28 断言过,fixture 转换 4 页,根/app tsc 干净;主管复核:禁改文件未动,verify_m8_pptx.py 独立复跑 28/28 绿
- [x] 步骤4 M10 T7/T8:ExtensionsPage+SkillPicker+Sidebar/App/TaskInput/ChatThread/TaskPage/HomePage 接线,app tsc 绿
- [x] 步骤5 M10 T6 验证:22 技能+8 连接器在线;/extensions 四接口 curl 全通;导入 hello-test-skill 成功;AC2 自动命中(word-html-spec)真实对话通过;AC3 手动指定全链路通过(含禁用态强制包含);AC4 filesystem MCP 工具真实列目录;AC5 坏连接器 lastError 中文+隔离;A4 禁用技能对 agent 不可见
- [x] 计划外修复:①Workspace 级 skills 沙箱问题→resolver 迁 Agent 级;②清单按名称排序→手动指定改用 inline skill 信号;③官方 fetch/git/sqlite/time 服务器在 npm 404→改 ${PY}+vendor/python 跑官方 Python 包,connector-runtime 支持 ${PY} 占位符(command+args)+错误中文化;sqlite 无 __main__ 改 -c 入口;示例库已建
- [x] M8 T4 收尾:html_to_pptx 注册进 index.ts+agent.ts;根 tsc 绿
- [x] M8 e2e:真实对话 5 页 PPT(封面/两栏/数据卡/标注框)一次成功,无临时脚本,产物标记正确,eastAsia 字体 OK
- [x] 步骤7 codex M9 完成:24/24 断言过(主管独立复核),禁改文件零触碰,.ref 过滤补在 workspace-routes.ts
- [x] M9 注册 xlsx_build(index.ts+agent.ts)+根 tsc 干净
- [x] 统一重启验证 C7:24 技能+8 连接器状态保持,ghost 'nope' 已清
- [x] M9 e2e:月度开支表两 sheet(skill→skill_read×2→xlsx_build,SUM/SUMIF/COUNTIF/IF 零保护,recalc 零错误,公式+缓存值双确认)
- [x] 三份 checklist 勾验完成;验收报告:docs/spec/overnight-report-20260916.md
- [x] codex 测试残留清理(gen_test_file.py/.syntax.ref/.月度开支.ref);临时 json 清理

## 收尾状态(2026-09-16 凌晨)

后端运行中(4111,后台任务 bdfyd0l47);全部里程碑功能完工,三份 checklist 与验收报告就绪;待用户人工目验:两个产物文件(WPS/Office)、扩展面板与技能选择器视觉、pptx/xlsx 右侧预览;改动未提交 git。
