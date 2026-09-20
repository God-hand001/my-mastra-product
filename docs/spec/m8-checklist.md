# M8 PPTX 生成 Checklist

> 验证方式:勾选时追加实际结果。A 组断言(scripts/verify_m8_pptx.py);B 组构建;C 组端到端对应 spec AC。

## A. 转换器与工具(脚本断言)

- [x] **A1**(T1)运行时:`import pptx` 成功;setup 脚本幂等(二次执行跳过) — codex+主管复跑 setup,冒烟 `m8m9-deps-ok`
- [x] **A2**(T1)骨架:最小 HTML → 页数正确(每 section 一页) — verify_m8_pptx.py PASS
- [x] **A3**(T2)文本:h1/h2/h3 字号阶梯、两级列表缩进、行内样式、内容完整 — PASS
- [x] **A4**(T2)中文字体:run 的 rPr 含 ea typeface=微软雅黑(缺省)→ AC2 — PASS;e2e 产物 python-pptx 读回确认 a:ea typeface 存在
- [x] **A5**(T2)版式:四种 data-layout 坐标在页内且不重叠(标题页/内容页/两栏/大图)→ AC3 — PASS
- [x] **A6**(T3)图片:三来源嵌入,width 生效;404→占位+warnings 恰 1 条 → AC4 — PASS(fixture 三来源图片,404 恰 1 条 warning)
- [x] **A7**(T3)组件:stat-cards 横排、callout 底色圆角、hr 横线,坐标在页内 — PASS
- [x] **A8**(T4)工具:合法 success;畸形→中文分类错误;runtime_missing 文案 — PASS(工具 id html_to_pptx、description 含 HTML 骨架示例)
- [x] **A9**(T4)防穿越:outputPath 越出 workspace 被拒 — PASS(safeOutputPath)
- [x] **A10**(T4)agent 规范:agent.ts 含 PPT 生成规范与骨架速查 — 已由主管写入 agent.ts「PPT 生成规范」段并注册工具
- [x] **A11**(T6)失败无残件:失败后输出目录无 .tmp/.pptx → AC6 — PASS(write_failed 分支)

> 断言总计 28 项,主管独立复跑 `vendor/python/python.exe scripts/verify_m8_pptx.py` 28/28 通过。

## B. 构建

- [x] **B1** 根 `npx tsc --noEmit` 无输出 — 多轮改动后复验均干净
- [x] **B2** `cd app && npx tsc --noEmit` 无输出
- [x] **B3** `cd app && npm run build` ✓ 结束 — `✓ built in 18.75s`(chunk 体积警告为既有问题)
- [x] **B4** `node --check` 无新改 js;vendor/python 无语法错误(两包均冒烟导入) — html_to_docx/html_to_pptx 均随 setup 冒烟,xlsx_recalc 待 M9

## C. 端到端

- [x] **C1**(AC1)PowerPoint/WPS 打开正常,页数内容对应(人工目验) — 用户 2026-09-16 用 WPS/Office 打开 嘉立创产品介绍.pptx 目验通过
- [x] **C2**(AC5)右侧预览按 slide 分页渲染、宽度无溢出 — 用户 2026-09-16 桌面端目验通过(首轮反馈"太宽/只看到一部分"经查是 xlsx 旧转网页路径所致,修复后复验通过)
- [x] **C3**(AC7)真实对话生成 5 页 PPT:HTML+一次工具调用、无临时脚本、产物卡+预览可用 — 实测:web_search→html_to_pptx 一次调用,产物【产物:嘉立创产品介绍.pptx】,5 页(封面/两栏/数据卡×4/warning 标注框/联系方式),python-pptx 读回全部吻合
- [x] **C4**(AC8)M7 Word 生成、内置浏览器、既有预览回归正常 — verify_m7_converter.py 27/27 复跑绿;html_to_docx 工具注册未动
- [ ] **C5**(F7)断网重试转换仍可用(仅远程图片降级) — 404→占位+warnings 已验证;整网断开场景未单独模拟
