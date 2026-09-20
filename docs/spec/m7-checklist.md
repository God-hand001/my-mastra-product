# M7 Word 文档生成引擎 Checklist

> 验证方式:勾选时在条目后追加实际结果(日期/输出/截图说明)。A 组为脚本化断言,T 编号对应 m7-task.md;C 组为端到端人工验收,对应 spec AC。
> 2026-09-15 首轮验证:A 组 27/27 通过(scripts/verify_m7_converter.py),根+app tsc 干净,端到端 V2 报告结构全对。

## A. 转换器与接入(脚本断言)

- [x] **A1**(T1)运行时冒烟:runtime-ok(2026-09-15)
- [x] **A2**(T2)基础映射:标题三级/两级列表/行内样式/居中全过
- [x] **A3**(T2)中文字体:eastAsia=宋体写入验证
- [x] **A4**(T2)失败分类:不可写路径 → write_failed;无 .tmp 残留
- [x] **A5**(T3)表格:底色 DCE9F9/边框/固定布局列宽
- [x] **A6**(T4)分节:节首显式分页符≥2(docx-preview 不认 pageBreakBefore,已改用 w:br type="page",见 plan 待验证项 3 定案);TOC 占位移交与表格锚点由分页符段落天然覆盖
- [x] **A7**(T4)目录域:TOC \o "1-3" \h 存在(begin 带 dirty)
- [x] **A8**(T4)页面设置:A4 11906x16838;页脚 PAGE/NUMPAGES;页眉内容
- [x] **A9**(T5)图片:三来源,404 → 占位+warnings 恰 1 条,2 张内嵌
- [x] **A10**(T5)装饰组件:标注框底纹(信息蓝/警示橙)+左色条 24/8pt+hr+数据卡片 20pt
- [x] **A11**(T6)工具层:成功路径经端到端验证(html_to_docx 实调通过);失败文案经 Python CLI 等价覆盖(runtime_missing 文案待专项验证)
- [ ] **A12**(T6)防穿越:`outputPath` 越出允许目录被拒绝(待专项验证)
- [x] **A13**(T7)agent 指令:规范段已在 instructions 且热加载生效

## B. 构建与环境

- [x] **B1** 根目录 `npx tsc --noEmit` 无输出(2026-09-15)
- [ ] **B2** `node --check app-desktop/main.js` 无输出(分类器故障窗口未跑)
- [ ] **B3** `node scripts/setup-python-runtime.mjs` 重复执行幂等(首次执行成功;幂等复跑待验证)
- [x] **B4** `.gitignore` 已含 `vendor/python/`、`vendor/_dist/`(git status 二进制未出现——尚未提交,待提交时复核)
- [ ] **B5** `cd app` tsc 通过;`npm run build` 待补跑(vite)

## C. 端到端验收(实机)

- [ ] **C1**(AC1)含标题/段落/列表/表格的 HTML 转换产物能被 Word 或 WPS 正常打开,内容对应
- [ ] **C2**(AC4/AC5)字体、样式、表格在 Word 中呈现正确(人工目验)
- [ ] **C3**(AC6)三节文档在 Word 与右侧预览面板中均按节切页,节内内容不被拆散
- [ ] **C4**(AC8)真实对话让 agent 生成多章节文档:行为为「HTML + 一次工具调用」,工作区无 `gen_xxx.js`/`verify_xxx.js` 等临时脚本
- [ ] **C5**(AC9)开发态(`npm run dev`)能力可直接使用;转换过程断网仍可用(仅影响远程图片,warnings 报告)
- [ ] **C6**(AC10)制造一次转换失败(不可写路径),输出目录无半成品
- [ ] **C7**(AC11)回归:既有 docx 预览、产物卡片、脚本折叠、任务摘要、内置浏览器均按原样工作
- [ ] **C8**(AC12/AC13)目录可点击跳转;页脚页码翻页递增;封面首页无页眉页脚
- [ ] **C9**(F7/AC2)故意触发一次转换失败,agent 能读取错误原因、修正 HTML 并在 ≤2 次重试内成功;持续失败则如实告知用户
- [ ] **C10**(打包态,可延后)electron-builder 打包后 `MEW_PYTHON_RUNTIME` 生效,产物内转换可用(N3)
