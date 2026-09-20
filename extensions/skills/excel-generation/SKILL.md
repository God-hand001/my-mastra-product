---
name: excel-generation
description: "生成新的 .xlsx 电子表格时使用本技能。适用场景:用户需要一份带公式、多 sheet、表头样式、列宽边框、数字格式或冻结首行的表格(如预算表、进度表、统计卡表)。不适用:编辑已有 xlsx、导出 CSV/TSV、生成 Word/PPT/HTML、调用在线表格 API。"
license: Proprietary
---

# Excel 生成规范

## 五步流程

1. **推断标题与落盘**
   - 根据用户意图给出中文文件名(如 `月度开支表.xlsx`)和相对 workspace 的路径(如 `报表/月度开支表.xlsx`)。
   - 若用户没指定 sheet 名,默认用 `Sheet1`;多 sheet 时用语义化名称(如 `预算`、`明细`、`汇总`)。

2. **必读设计准则**
   - 先读 `references/schema_principle.md`,再读 `references/patterns/` 中匹配度最高的场景范式。
   - 不要凭记忆写样式,颜色、锚点、公式保护规则均以准则为准。

3. **判定场景原型**
   - 预算表 → 收支分类 + 小计/合计 + 占比公式。
   - 进度表 → 任务/开始/结束/进度 + 甘特式状态公式。
   - 统计卡表 → 多维度汇总 + 同比/环比公式 + 卡片式顶部摘要。
   - 都不匹配时,以准则中的通用 sheet 结构为底线。

4. **写 build.py 经 xlsx-build 工具交付**
   - 脚本必须是完整可运行的 Python 文件,通过 `sys.argv[1]` 获得产物绝对路径并用 `wb.save(sys.argv[1])` 保存。
   - 只 import 预装库(`openpyxl`、`formulas` 等),禁止 `pip install`/`subprocess`/`os.system`/`eval`/`exec`。
   - 脚本只负责写文件,不自己运行 recalc;重算由 `xlsx-build` 工具自动调用。

5. **读 recalc JSON 判定**
   - 只看返回 JSON 中的 `status` 和 `totalErrors`,**不要看退出码**。
   - `status === "success"` 才能交付;`errors_found` 必须按 `errorSummary` 定位修复后重跑(最多 3 次)。
   - `status === "error"` 时(外部引用、动态数组、超时、引擎缺失),按中文 message 告知用户,不要假装成功。

## 适用 / 拒绝条件

- **适用**: 用户明确要新建 xlsx;或对话上下文确定最终产物是 .xlsx;或需要公式驱动的可编辑表格。
- **拒绝**: 编辑已有 xlsx(应让用户另存新名后再走生成分支);要 CSV/TSV(走文本生成);要 Word/PPT/HTML(走对应技能);要在线协作/图表对象/宏(本模块一期不支持,如实说明)。

## 判定纪律

- recalc 相关一切判定**读 JSON 的 status/totalErrors,不看退出码**。
- 公式错误定位到单元格后,必须回到步骤 4 修改脚本再重跑,不能直接改产物 xlsx。
- 连续失败 3 次仍无法 `success`,如实告知用户失败原因和已定位的错误单元格,不要伪造产物。

## 防错纪律

- **分母空值零保护**: 公式中所有除法、平均、占比都要做空值/零保护。例如 `=IF(COUNT(B2:B10)=0,0,SUM(B2:B10)/COUNT(B2:B10))` 或 `=IF(B2=0,0,A2/B2)`。**保护必须写进公式字符串**,不能靠 Python 预计算。
- **坐标锚点**: 表头行、汇总行、数据起始行用常量写在脚本开头(如 `DATA_START = 2`; `TOTAL_ROW = 20`),不要硬编码在多处。
- **XL_ 颜色常量**: 颜色用 `openpyxl.styles` 自带常量或 6 位十六进制字符串,如 `PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid")`,不要依赖系统主题色。
- **不 pip install**: 运行时不联网;若 openpyxl 导入失败,说明 Python 运行时未就绪,应提示用户运行 `node scripts/setup-python-runtime.mjs`。
- **公式不硬编码结果**: 所有可计算字段必须写 Excel 公式,不能用 Python 算好再填数值。
- **中文表头**: 除用户明确要求英文外,表头、sheet 名、批注均用中文。

## 交付话术

- 成功后说: “已生成 `【产物:报表/月度开支表.xlsx】`,含 N 个 sheet、M 个公式,recalc 校验通过(0 错误)。”
- 紧接着提示: “如需清理建表脚本工作目录,可说‘清理 报表/月度开支表.xlsx 的 .ref’。”
- 失败时说: “建表/重算未通过,错误信息如下…;我可以按定位修改后重试。”
