# M9 XLSX 生成 Checklist

> 验证方式:勾选时追加实际结果。A 组断言(scripts/verify_m9_xlsx.py);B 组构建;C 组端到端对应 spec AC。
> 判定纪律提醒:所有 recalc 相关断言**读 JSON 的 status/totalErrors**,不看退出码。

## A. 重算与工具(脚本断言)

- [x] **A1**(T1)openpyxl+formulas 装入 vendor/python,导入冒烟通过;引擎边界结论回写 plan — setup 冒烟 `m8m9-deps-ok`;T1 结论(SUM/AVERAGE/IF/VLOOKUP/SUMPRODUCT 可求值;动态数组/外部引用=error;缓存值回填走 xlsx zip sheet XML 直改)已写入 m9-plan.md
- [x] **A2**(T2)recalc:全对公式 → success + backfilled=true;读回 data_only 值非 None — verify_m9_xlsx.py PASS
- [x] **A3**(T2)含 #DIV/0!/#REF! → errors_found + errorSummary 定位到单元格,退出码 0 → AC3 — PASS(读 JSON status/totalErrors)
- [x] **A4**(T2)外部链接/动态数组 → status=error + 中文说明,不假成功 — PASS
- [x] **A5**(T3)工具闭环:合法 build.py → ok + .xlsx 落盘 + recalc.success — PASS;e2e 再次验证
- [x] **A6**(T3)脚本含 pip install/subprocess → 拒绝 + 中文提示 → AC4 — PASS
- [x] **A7**(T3)语法错误脚本 → 中文 stderr 定位;超时 → 中文报错 — PASS
- [x] **A8**(T3)clean:true → .ref 目录消失 → AC6 — PASS
- [x] **A9**(T3)防穿越:xlsxPath 越出 workspace 被拒 — PASS
- [x] **A10**(T4)excel-generation 技能 5 文件齐;frontmatter 可解析;工作区无 build*.py 残留 → AC5 — SKILL.md+schema_principle.md+patterns/三范式齐;agent 流程经 .ref 工作目录交付,workspace 根无脚本残留(已清理 codex 测试文件)
- [x] **A11**(T5)M7 回归:verify_m7_converter.py 仍全绿 → AC8 侧 — 27/27 复跑绿;verify_m9 内含该项 PASS

> 断言总计 24 项,主管独立复跑 `vendor/python/python.exe scripts/verify_m9_xlsx.py` 24/24 通过。

## B. 构建

- [x] **B1** 根 `npx tsc --noEmit` 无输出 — 工具注册后复验干净
- [x] **B2** `node --check` 相关 js 无输出 — setup 脚本 node 执行验证
- [x] **B3** vendor/python 双包(html_to_docx/xlsx_recalc)冒烟导入通过 — 加 html_to_pptx 三包全过

## C. 端到端

- [x] **C1**(AC1)Excel/WPS 打开预算表,公式可编辑(人工目验) — 用户 2026-09-16 用 WPS/Office 打开 月度开支表.xlsx 目验通过(公式字符串已确认保留)
- [x] **C2**(AC2)右侧 SheetJS 预览显示公式数值(非空白) — 缓存值已回填并经 openpyxl data_only 读出(SUM=5875.6/SUMIF 跨表/IF 占比全对);SheetJS 读缓存值即有数值
- [x] **C3**(AC7)真实对话全流程:技能命中→xlsx-build→零错误→产物卡+预览 — 实测「月度开支表两 sheet」:skill→skill_read×2→xlsx_build 一次交付,SUM/SUMIF/COUNTIF/IF(零保护)全部 recalc 零错误,产物标记正确
- [ ] **C4**(F5)故意一次失败(坏公式),agent 定位修复重跑 ≤3 内成功;持续失败如实告知 — 重试机制在技能与工具返回中就绪(errors_found 带 errorSummary 定位);端到端未自然触发坏公式场景,未单独构造
- [x] **C5**(AC8)Word/PPT 生成、浏览器、预览回归正常 — M7 27/27、M8 28/28、PPT 端到端通过
