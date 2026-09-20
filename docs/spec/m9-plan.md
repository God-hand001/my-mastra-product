# M9 XLSX 生成 Plan

> 前置:[m9-spec.md](./m9-spec.md)(模式决策:受控脚本,用户已确认)、M7 运行时、M10 技能体系
> 技术栈:openpyxl + formulas(加入 vendor/python);预览复用 SheetJS 零改动

## 架构概览

与 M7/M8 的「固定转换器」不同,M9 的核心是**工具化的受控执行闭环**:

```
用户任务 → agent 命中 excel-generation 技能 → 读设计准则/范式 → 写 build.py(经工具)
  → xlsx-build 工具:落 .ref 工作目录 → vendor/python 执行 → recalc.py 重算回填
  → 公式零错误? ──否→ 定位错误 → 改脚本重跑(≤3)
       │是
       ▼
  交付 .xlsx + 产物标记 → SheetJS 预览(读缓存值,零改动)
```

## 核心数据结构

### xlsx-build 工具契约

```ts
input:  { buildScript: string, xlsxPath: string(相对 workspace), clean?: boolean }
output: { ok: true, xlsxPath, recalc: { engine: 'formulas'|'none', status: 'success'|'errors_found', totalErrors: number, errorSummary?: string },
          warnings: string[] }
       | { ok: false, error: string(中文,含 stderr 定位), recalc?: … }
```

### 工作目录约定

`src/mastra/public/workspace/.<xlsx基名>.ref/`(点前缀=隐藏目录,产物扫描需跳过——**实现时确认既有产物列表/预览扫描对点前缀目录的处理,若未处理则在扫描处过滤**)。build.py 与 recalc 中间产物都在其内;交付后可 clean。

### recalc.py 契约(独立 CLI,converter 无关)

`python recalc.py <xlsx> <timeout秒>` → stdout JSON:`{ engine, status, totalErrors, errorSummary: [{cell, kind}] , backfilled: bool }`。判定纪律:只有内部异常才非零退出,`errors_found` 退出码 0——**调用方必须读 JSON,不得看退出码**。

## 模块设计

### 模块 A:运行时扩展(scripts/setup-python-runtime.mjs)

CORE_DEPS 追加 `openpyxl`、`formulas`;拷贝逻辑扩展到 recalc 所在位置(见模块 B 文件组织)。
**依赖**:M7 运行时。

### 模块 B:recalc.py(scripts/recalc.py 或 tools 包内)

- `formulas` 引擎加载 xlsx → 求值全部公式 → 与 openpyxl 协作把计算值回填为缓存值(公式字符串保留)
- 失败语义:动态数组/多值 spill、外部链接、不支持的函数 → `status=error` 并附中文说明(不假成功);逐格错误(#REF!/#DIV/0! 等)→ `errors_found` + errorSummary
- 超时控制(默认 60s);**依赖 formulas 引擎能力边界,以实测为准**(plan 待验证项 1)
**依赖**:模块 A。

### 模块 C:xlsx-build 工具(src/mastra/tools/xlsx-build.ts)

- zod 输入;`.ref` 工作目录创建与清理(`clean:true` → 删目录返回 ok);build.py 写入与 vendor/python 执行(60s 超时,stderr 捕获)
- **静态安全检测(N2)**:脚本含 `pip install`/`subprocess`/`os.system`/`eval(` 直接拒绝(中文原因)——白名单式从宽:只拦明确危险模式
- 执行成功后自动调 recalc.py;组装结果 JSON;错误中文化(stderr 关键行 + 分类)
- 防穿越(workspace 根内);工具注册 index.ts
**依赖**:模块 A、B。

### 模块 D:生成技能(extensions/skills/excel-generation/,M10 体系)

- SKILL.md:五步流程(推断标题/读准则/判原型/写脚本/重算交付)+适用拒绝条件+判定纪律(读 JSON 不看退出码)+防错纪律(分母保护/坐标锚点/XL_ 颜色常量/不 pip install)+交付话术
- references/schema_principle.md:自研中文建表准则(sheet 结构/列/公式/样式/条件格式)
- references/patterns/:预算表、进度表、统计卡表 3 个场景范式(自研)
- 注册走 M10 既有机制(setup-extensions.mjs 把该技能纳入本地清单;M10 未上线前先落 extensions/skills/ 目录即可,M10 上线自动发现)
**依赖**:M10(技能发现机制);内容自研不抄 sheetagent。

### 模块 E:agent 接线(src/mastra/agents/agent.ts)

instructions 仅加一行:「生成 xlsx 必须先查看并遵循 excel-generation 技能,通过 xlsx-build 工具交付」(细则在技能里,M10 红利)。

## 文件组织

```
scripts/setup-python-runtime.mjs        → 修改:openpyxl+formulas
src/mastra/tools/xlsx_recalc/recalc.py  → 新建:重算 CLI(随包拷贝进运行时)
src/mastra/tools/xlsx-build.ts          → 新建:建表工具
extensions/skills/excel-generation/…    → 新建:生成技能(SKILL.md+references)
src/mastra/agents/agent.ts / index.ts   → 修改:一行规范 + 注册
docs/spec/fixtures/m9-budget.prompt.md  → 验收用任务描述(非 fixture 文件)
scripts/verify_m9_xlsx.py               → 新建:A 组断言
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 生成模式 | 受控脚本(方案 B,spec 待确认) | 公式/多表/条件格式 HTML 表达不了;WorkBuddy 实证;与 M7 否掉的"无校验乱脚本"有本质区别 |
| 重算引擎 | formulas 纯 Python | 免 200MB LibreOffice;常规公式覆盖;失败语义明确不假成功 |
| 规范承载 | M10 技能(非 instructions) | 渐进式加载省 token;准则/范式可独立演进;M10 红利 |
| 垃圾脚本 | .ref 隐藏工作目录 + clean 参数 | 与 M7 AC8 精神一致:产物区干净 |
| 安全 | 工具层静态检测拒绝 pip/subprocess | 防依赖漂移与逃逸;从宽白名单避免误杀 |
| 预览 | SheetJS 零改动 | recalc 回填缓存值后 SheetJS 可读 |

## 待实现时验证的技术细节

﻿1. **formulas 引擎边界(T1 已实测)**
   - **可求值范围**: 常规统计/查找/逻辑函数可正常计算,已验证 `SUM`、`AVERAGE`、`IF`、`VLOOKUP`、`SUMPRODUCT`、比较运算、加减乘除。`formulas` 以 `ExcelModel().loads(...).finish().calculate()` 返回每个单元格/区域的 `Ranges`;结果需用 `np.asarray(rng.value)` 读取,标量取 `[0,0]`,numpy 标量用 `.item()` 转 Python 原生类型。
   - **结果读出方式**: `calculate()` 返回字典,键形如 `'[file.xlsx]Sheet'!A1`;按 `'!` 拆出工作表名与坐标,区域键含 `:`,需按区域行列展开回填。
   - **动态数组/多值公式行为**: 纯数组运算(如 `=A2:A4*B2:B4`)、CSE 数组公式会返回 `#VALUE!` 或在计算阶段抛出异常;`UNIQUE` 等动态函数在 `formulas` 中不真正溢出,会静默截断首元素。**recalc 把动态数组/多值公式识别为引擎不支持的 error 语义**,禁止交付,不由 agent 当作普通错误单元格忽略。
   - **错误单元格呈现**: 除零公式(`=B2/B4`)计算结果为 `#DIV/0!`,字符串化后以错误值处理。回填时错误单元格的 `<c>` 设置 `t="e"`、`<v>` 写入 `#DIV/0!`,`openpyxl.data_only=True` 可读取为字符串;SheetJS 对错误缓存值的显示可能映射为内部错误码,但**交付物要求零错误**,故不影响最终产物。
   - **公式字符串保留+回填缓存值可行写法**: `openpyxl` 的 `Cell.value` setter 在公式模式下会丢弃缓存值,因此不通过 openpyxl 保存,而是**直接修改 xlsx(zip) 的 `xl/worksheets/sheetN.xml`**:
     - 定位每个含 `<f>` 的 `<c>`;
     - 在 `<f>` 后插入 `<v>`;
     - 按缓存值类型设置 `t`: 数值 `n`、字符串 `str`、布尔 `b`、错误 `e`;
     - 数值/字符串已验证可被 `openpyxl.data_only=True` 与 SheetJS 正常读出。
   - **不可行项**: `formulas` 的 `ExcelModel.write()` 会把公式替换为计算后的值,**不能**用于保留公式字符串;外部引用(如 `=[other.xlsx]Sheet1!A1`)在 `loads()` 阶段即抛出 `FormulaError`,属于 recalc 的 error 语义。
2. **产物扫描对点前缀目录(已实测并处理)**
   - 既有 `/workspace/files` 列表路由会把 `.xxx.ref/` 等点前缀目录扫出来并返回给前端。
   - 已在 `src/mastra/server/workspace-routes.ts` 的 GET `/workspace/files` 处理器中增加过滤:`dirents.filter(e => !e.name.startsWith('.'))`,确保 `.ref` 工作目录不出现在产物列表/产物卡中。
3. **SheetJS 读回填值(已验证)**
   - recalc 回填后的数值与字符串缓存值可被 `xlsx`(SheetJS) 正确读出(如 `D1.v === 30`、`D5.v === '大'`);错误缓存值因 `t="e"` 在 SheetJS 中可能映射为内部错误码,但交付物要求零错误,不影响预览。
4. **openpyxl+formulas 在 vendor/python 3.12 的兼容性(已验证)**
   - `scripts/setup-python-runtime.mjs` 已预装 `openpyxl 3.1.5` 与 `formulas 1.3.4`,`vendor/python/python.exe -c "import openpyxl, formulas"` 冒烟通过,recalc 全对/除零/外部引用/动态数组用例均正常。
