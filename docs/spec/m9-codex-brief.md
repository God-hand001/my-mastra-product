# M9 XLSX 生成 — codex 执行任务书

你是本仓库(Mastra+React 产品)的实现工程师。先通读以下文件再动手:

- docs/spec/m9-task.md、docs/spec/m9-plan.md、docs/spec/m9-spec.md(需求/契约/验收)
- M7 同构参照:src/mastra/tools/html-to-docx.ts(工具模式:zod/防穿越/临时文件/子进程/错误中文化)、scripts/verify_m7_converter.py 与 scripts/verify_m8_pptx.py(断言脚本组织方式)
- M10 机制参照:extensions/skills/word-html-spec/(技能文件的 frontmatter 与组织)

## 环境事实(已由主管准备,不要重复做)

- vendor/python 就绪,openpyxl 与 formulas 已安装且冒烟通过(`vendor/python/python.exe -c "import openpyxl, formulas"` 通过)。
- scripts/setup-python-runtime.mjs 已支持把 src/mastra/tools/ 下的 xlsx_recalc 包拷入运行时(目录存在即拷)。**禁止修改本脚本**;建好包后重跑 `node scripts/setup-python-runtime.mjs` 同步。
- workspace 根 = src/mastra/public/workspace(绝对路径,项目根=仓库根)。
- M10 技能体系已上线:extensions/skills/ 下的技能会被自动发现;excel-generation 技能落地后即可被 agent 读取。
- 后端服务(4111 端口)由主管管理:**禁止启动/重启任何 dev 服务,禁止调用 REST/对话接口**;一切验证用直接调 python/node 的方式完成。

## 执行范围(对应 m9-task.md)

1. **T1 spike(先行)**:构造含 SUM/AVERAGE/除法/VLOOKUP/IF 各一的测试 xlsx,用 formulas 引擎实测:可求值范围、结果读出方式、动态数组(SUMPRODUCT 等)行为、错误单元格(#DIV/0!)呈现、**公式字符串保留同时回填缓存值的可行写法**(openpyxl 直接操作或 formulas API,以实测为准)。四项结论**回写 docs/spec/m9-plan.md**(把「待验证项 1」改写为结论小节,注明不可行项=recalc 的 error 语义)。验证后删除临时脚本。
2. **T2**:`src/mastra/tools/xlsx_recalc/`(`__init__.py`、`recalc.py`、`__main__.py`):`python -m xlsx_recalc <xlsx> [timeout秒]`;强制 UTF-8 stdio(Windows 子进程 GBK 坑,M7 实证);stdout 单行 JSON `{ engine, status: 'success'|'errors_found'|'error', totalErrors, errorSummary: [{cell, kind}], backfilled, message? }`;errors_found 退出码 0;内部异常 status=error + 中文 message;超时归入 error。四个用例(全对/除零/外部引用/动态数组)各跑一遍贴 JSON。
3. **T3(仅工具文件)**:新建 `src/mastra/tools/xlsx-build.ts`(照 html-to-docx.ts 模式):zod `{ buildScript, xlsxPath, clean? }`;safeOutputPath 防穿越;`clean:true` → 删 `.ref` 目录返回 `{ ok:true, cleaned:true }`;静态安全检测(`pip install`/`subprocess`/`os.system`/`eval(` 命中即拒,中文提示);`.ref` 工作目录 = workspace 根下 `.<xlsx基名>.ref/`;写入 build.py → `vendor/python/python.exe build.py`(60s 超时,stderr 捕获,超时中文报错)→ 成功后自动 `python -m xlsx_recalc <产物路径> 60` → 组装结果 JSON(契约见 m9-plan「xlsx-build 工具契约」)。子进程调 python 用 services/python-runtime.ts 的 resolvePythonRuntime(参照 html-to-docx.ts 的写法)。
4. **T4**:`extensions/skills/excel-generation/`(SKILL.md + references/schema_principle.md + references/patterns/预算表.md、进度表.md、统计卡表.md):五步流程/适用拒绝条件/判定纪律(读 JSON 不看退出码)/防错纪律(公式分母空值零保护写进公式字符串/坐标锚点/XL_ 颜色常量/不 pip install)/交付话术+.ref 清理提示;全部**自研中文**,不抄任何现有产品文本;frontmatter 按 anthropics/skills 规范(name/description 写清何时用)。
5. **T5**:`scripts/verify_m9_xlsx.py`:A1 依赖冒烟/A2 recalc 全对+backfilled/A3 errors_found 定位+退出码 0/A4 外部引用与动态数组=error/A5 工具闭环/A6 pip install 拒绝/A7 语法错误 stderr 定位/A8 clean 清理/A9 防穿越/A10 技能文件齐 5 个+frontmatter 可解析/A11 verify_m7_converter.py 复跑仍绿。全绿为完成标志。
6. **产物扫描点前缀验证**(m9-plan 待验证项 2):实测 `.ref` 隐藏目录是否会出现在 workspace 文件列表里(读 src/mastra/server/workspace-routes.ts 的列表逻辑判断即可,若会列出,把过滤补丁做在该文件——它不在禁改清单)。结论写进最终报告。

## 禁改文件(主管并行编辑中,动则冲突)

- src/mastra/agents/agent.ts、src/mastra/index.ts(工具注册与 agent 规范由主管完成)
- scripts/setup-python-runtime.mjs
- app/ 目录整个(本里程碑无前端改动)

若 `npx tsc --noEmit` 报出禁改文件的错误,忽略(主管并行编辑造成),只对自己的文件负责。���止 git commit。

## 验证纪律

- 判定纪律贯穿实现与验证:recalc 相关一切断言**读 JSON 的 status/totalErrors,不看退出码**。
- 每步验证输出(命令+关键输出)保留,最终一次性汇总输出。
- 根目录 `npx tsc --noEmit` 必须无输出(你的 xlsx-build.ts 在根 tsconfig 内)。
- recalc 调试时重跑 `node scripts/setup-python-runtime.mjs` 同步包,或临时 `PYTHONPATH=src/mastra/tools`。

全程中文注释与中文错误文案。现在开始,按 T1→T5 顺序执行。
