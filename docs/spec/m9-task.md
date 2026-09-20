# M9 XLSX 生成 Tasks

> 前置:[m9-spec.md](./m9-spec.md)(模式决策=受控脚本)、[m9-plan.md](./m9-plan.md) 已确认;依赖 M7 运行时与 M10 技能体系(技能目录先落盘,发现机制 M10 上线即接管)
> 通用约束:同 M7/M8;recalc.py 自研不抄 sheetagent 代码;判定纪律「读 JSON 不看退出码」贯穿实现与验证。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `scripts/setup-python-runtime.mjs` | deps 加 openpyxl、formulas;拷贝含 recalc 的包 |
| 新建 | `src/mastra/tools/xlsx_recalc/`(Python 包:recalc.py) | 重算 CLI |
| 新建 | `src/mastra/tools/xlsx-build.ts` | 受控建表工具 |
| 新建 | `extensions/skills/excel-generation/` | 生成技能(SKILL.md + references) |
| 修改 | `src/mastra/agents/agent.ts`、`src/mastra/index.ts` | 一行规范 + 注册 |
| 新建 | `scripts/verify_m9_xlsx.py` | A 组断言 |

---

## T1: spike —— formulas 引擎边界(先行,结论回写 plan)

**产物:** plan「待验证项 1」改写为结论;最小验证脚本(临时,验证后删)
**依赖:** 运行时加装 openpyxl+formulas

**步骤:**
1. setup 脚本加依赖并执行;`import openpyxl, formulas` 冒烟。
2. 构造测试 xlsx(含 SUM/AVERAGE/除法/VLOOKUP/IF 各一):用 formulas 引擎加载求值,验证:可求值的函数范围、结果读出方式、动态数组(SUMPRODUCT 等)行为、错误单元格(#DIV/0!)的呈现。
3. 验证缓存值回填:openpyxl 保留公式字符串的同时写入缓存值的 XML 机制(`cell.value = 公式` 后如何只补缓存——以 formulas 库提供的 API 或直接操作 worksheet XML 实测,找到可行写法)。
4. 验证 SheetJS(前端既有)对回填后文件的读取(手动开预览确认)。

**验证:** 四项结论写进 plan;不可行项(如动态数组)明确标注为 recalc 的 error 语义。

---

## T2: recalc.py 重算 CLI

**文件:** `src/mastra/tools/xlsx_recalc/`(`__init__.py`、`recalc.py`、`__main__.py`)
**依赖:** T1

**步骤:**
1. `__main__.py`:`python -m xlsx_recalc <xlsx路径> [timeout秒]`;强制 UTF-8 stdio;stdout 单行 JSON:`{ engine, status: 'success'|'errors_found'|'error', totalErrors, errorSummary: [{cell, kind}], backfilled: bool, message? }`。
2. 重算:formulas 加载求值 → 成功则逐公式回填缓存值(T1 定案的写法)→ 保存;内部异常 → `status=error` + 中文 message(动态数组/外部链接/不支持函数在此层识别并说明)。
3. 逐格错误收集:`#REF!/#DIV/0!/#VALUE!/#NAME?` 等 → errors_found + errorSummary(单元格坐标+类型);**errors_found 退出码 0**。
4. timeout 参数控制引擎求值预算,超时归入 `error`。

**验证:** 临时脚本跑四个用例并贴 JSON:全对公式(success+backfilled)、含除零(errors_found+定位)、含外部引用(error)、含动态数组(error,若 T1 定案如此);断言 errors_found 用例退出码为 0。

---

## T3: xlsx-build 工具

**文件:** `src/mastra/tools/xlsx-build.ts`(新建)、`src/mastra/index.ts`(修改)
**依赖:** T2

**步骤:**
1. zod `{ buildScript, xlsxPath, clean? }`;防穿越(同 html-to-docx 的 safeOutputPath);`clean:true` → 删 `.ref` 目录返回 `{ ok:true, cleaned:true }`。
2. 静态安全检测:`pip install`、`subprocess`、`os.system`、`eval(`/`exec(` 命中即拒(中文原因,提示只 import 预装库)。
3. `.ref` 目录(`src/mastra/public/workspace/.<基名>.ref/`)写入 build.py → `vendor/python/python.exe build.py` 执行(60s 超时;stderr 捕获;超时中文报错)→ 成功后自动调 `python -m xlsx_recalc` → 组装结果 JSON。
4. 输出目录预创建;产物 .xlsx 落在用户指定路径(非 .ref 内);工作区产物扫描对 .ref 的过滤(plan 待验证项 2,实测后处理)。
5. agent.ts 加一行规范(生成 xlsx 先查 excel-generation 技能、经 xlsx-build 交付);index.ts 注册。

**验证:** 根 `npx tsc --noEmit` 通过;临时脚本直调工具:合法脚本→ok+recalc.success;含 pip install→拒绝;语法错误脚本→中文 stderr 定位;clean 后 .ref 消失。输出贴报告。

---

## T4: excel-generation 生成技能

**文件:** `extensions/skills/excel-generation/`(SKILL.md、references/schema_principle.md、references/patterns/预算表.md、进度表.md、统计卡表.md)
**依赖:** T3(契约明确后写流程)

**步骤:**
1. SKILL.md(YAML frontmatter:name/description 按 anthropics/skills 规范;description 写清何时用):五步流程(推断标题与落盘 → 必读设计准则 → 判定场景原型 → 写 build.py 经 xlsx-build 交付 → 读 recalc JSON 判定);适用/拒绝条件(编辑已有 xlsx/要 csv 等拒绝);判定纪律(读 JSON status,不看退出码);防错纪律(公式分母空值/零保护写进公式字符串、坐标锚点、XL_ 颜色常量、不 pip install);失败重试 ≤3 后如实告知;交付话术 + 提示可清理 .ref。
2. schema_principle.md:自研中文准则(sheet 结构/表头/列宽/样式/条件格式/公式原则,500-800 行内)。
3. patterns/ 三个场景范式:预算表、进度表、统计卡表(结构+公式+样式的可改编蓝图)。
4. **全部自研中文,不复制 sheetagent 文本**;frontmatter 遵循 anthropics/skills 规范(M10 自动发现)。

**验证:** frontmatter 被 M10(或临时解析脚本)正确解析;技能文件齐 5 个;grep 确认无 pip install 字样出现在流程指引中。

---

## T5: 断言脚本与端到端

**文件:** `scripts/verify_m9_xlsx.py`(新建)
**依赖:** T2–T4

**步骤:**
1. 断言脚本:构造含 5 公式(含分母保护)的 build.py 经工具执行 → openpyxl 读回(data_only=True)断言缓存值非 None;坏公式 → recalc errors_found 定位;pip install 拒绝;clean 清理;N4 回归点(M7 转换器仍绿——复跑 verify_m7_converter.py)。
2. 端到端:真实对话「做一份带公式的月度开支表,两个 sheet」:技能命中 → xlsx-build 一次交付 → 产物卡+预览有数值(AC7);Excel/WPS 打开公式可编辑(AC1 人工)。

**验证:** 断言全绿;checklist 勾验记录。

---

## 执行顺序

T1 → T2 → T3 → T4(可与 T2/T3 并行) → T5
