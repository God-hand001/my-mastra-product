# M9 XLSX 生成 Spec

> 产品:嘉立创办公(基于 Mastra harness)
> 前置:M7 Python 运行时;**M10 技能体系**(生成规范以技能承载);本模块同时依赖两者
> 调研:参考产品 sheetagent 插件(3 文件/1763 行,openpyxl + recalc 重算)

## 背景与模式决策(✅ 用户已确认 2026-09-15:方案 B,与 WorkBuddy 对齐)

参考产品的 Excel 路线**不是**固定转换器,而是「agent 按技能规范自己写 openpyxl 建表脚本 → 执行 → 重算校验 → 交付」。这与 M7 在 Word 上否掉的"一次性脚本"形似,但有本质区别:

| | M7 否掉的模式 | sheetagent 受控模式 |
|---|---|---|
| 脚本位置 | 随意丢在工作区 | 固定隐藏工作目录 `.<文件名>.ref/`,不混入产物 |
| 质量依据 | 模型自由发挥 | 技能内含设计准则(必读)+建表范式库 |
| 结果校验 | 无 | recalc 重算,公式零错误才准交付 |
| 依赖安装 | 模型乱 pip | 运行时预装,脚本只 import 不 install |

**本模块推荐采用受控脚本模式(方案 B)**,理由:xlsx 的核心语义(公式/多表/条件格式/图表)无法用 HTML 表达——固定转换器(方案 A)会把 Excel 最有价值的部分砍掉;WorkBuddy 已实证 B 可收敛。若你倾向与 Word/PPT 完全同构的方案 A(表达力受限,公式只能写死计算值),告知后重写本 spec。

## 目标

- G1:agent 生成 xlsx 走「技能规范 + 受控建表脚本 + 重算校验」闭环
- G2:公式可用且**重算零错误**,预览器能读到缓存值(非空白)
- G3:工作区不残留建表脚本(工作目录约定,交付后可清理)
- G4:多 sheet/样式(表头底色/列宽/边框/数字格式)/冻结首行按准则呈现

## 功能需求

- **F1 建表工具**:`xlsx-build` 工具——输入 {buildScript(完整 openpyxl 脚本文本), xlsxPath(workspace 相对)};后端把脚本写入隐藏工作目录 `src/mastra/public/workspace/.<xlsx基名>.ref/build.py`,用 vendor/python 执行;返回结构化 JSON {ok, xlsxPath, recalc: {engine, status, totalErrors}, warnings, error?}
- **F2 重算校验(recalc.py)**:自研(借鉴参考产品思路,不抄代码)——用 `formulas` 纯 Python 引擎对产物重算,把公式缓存值回填(公式字符串保留);判定只看 JSON(status/totalErrors),不看退出码;动态数组/多值公式/外部链接明确报错而非假成功;`formulas` 不可用时返回 engine=none 的明确警告(公式可能显示空白),由 agent 决定降级为写死计算值重试
- **F3 生成技能(excel-generation)**:M10 技能体系承载——SKILL.md 写明五步流程(推断标题与落盘→读设计准则→判定场景原型→写脚本→重算校验交付)、适用/拒绝条件、防错纪律(公式分母保护/坐标锚点/颜色常量/不无条件 pip);references/ 放设计准则(schema_principle)与场景范式(预算表/进度表/统计表等 3-5 个,自研中文);**技能内容自研,不复制 sheetagent 文本**
- **F4 产物规范**:交付后按产物输出规范输出【产物:…】标记;预览走既有 SheetJS 链路(零改动)
- **F5 失败闭环**:build.py 执行失败→stderr 定位→改脚本重跑(≤3 次);recalc 报公式错误→修公式重算;持续失败如实告知
- **F6 清理纪律**:交付后在回复中提示可让助手清理 `.ref/`;`xlsx-build` 工具提供 `clean: true` 参数一次清空对应工作目录

## 非功能需求

- **N1 离线**:openpyxl/formulas 已预装,转换与重算离线可用
- **N2 隔离**:脚本只 import 预装库;工具层拒绝脚本里的 `pip install`(静态检测,命中即拒并提示)
- **N3 性能**:常规 xlsx(<1 万格)建表+重算数秒内
- **N4 回归**:Word/PPT 生成、预览、浏览器不受影响

## 不做的事

- LibreOffice 权威重算层(需 200MB+ 外部依赖;formulas 引擎覆盖常规公式,动态数组类明确报错)
- 图表对象(一期;xlsx 图表 openpyxl 可做但验收面大,有需求另立)
- xlsx 的二次编辑/协作锁定
- 把生成规范塞 agent instructions(走 M10 技能)

## 验收标准

- **AC1**:技能规范指导下,agent 生成含 2 个 sheet、5 个公式(含除法分母保护)的预算表:产物在 Excel/WPS 正常打开,公式可编辑
- **AC2**(F2):recalc 后公式缓存值存在——右侧 SheetJS 预览显示数值而非空白
- **AC3**(F2):故意写一个 #REF!/除零公式 → recalc 报 errors_found 且定位到单元格 → agent 修复后重算零错误
- **AC4**(F1/N2):脚本含 pip install → 工具拒绝并给中文提示
- **AC5**(F3):工作区(除 .ref 外)无 build*.py 等建表脚本残留;.ref 不出现在产物列表
- **AC6**(F6):clean 参数执行后 .ref 目录消失
- **AC7**:真实对话「做一份带公式的月度开支表」全程闭环:技能命中→脚本→校验→产物卡+预览有数值
- **AC8**:Word/PPT/浏览器/预览回归正常
