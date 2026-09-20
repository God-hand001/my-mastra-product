---
name: word-html-spec
description: 规范 Word 文档生成：一律先写完整 HTML，再调用 html_to_docx 工具一次转换；包含 HTML 结构与样式约定。
---

# Word 文档生成规范

## 总原则
生成 `.docx` 一律先写一份完整 HTML（含 `head`/`body`），然后调用 `html_to_docx` 工具一次转换，禁止编写并执行任何一次性生成脚本（.js/.py）。

## HTML 约定速查
- 每个章节包一个顶层 `<section>…</section>`，每章自动从新页开始，不要自己插分页符。
- 目录位置放 `<nav data-toc>目录</nav>`（收录三级标题，Word 中可更新域刷新页码）。
- 页眉页脚用 `<meta name="doc-header" content="…">` / `<meta name="doc-footer" content="第 {{page}} 页 / 共 {{pages}} 页">`；封面章不需要页眉页脚时加 `<meta name="doc-first-page-plain" content="true">`。
- 纸张边距默认 A4 常规边距，可写 `@page { size: A4; margin: 2.54cm 3.18cm }`。
- 中文字体写在 `body { font-family: "宋体", serif }`（转 Word 时会正确写入中文字体）。
- 提示块用 `<div class="callout" data-type="info|success|warning|danger">`；数据卡片用 `<div class="stat-cards">…</div>`。
- 表格直接用 `table/th/td`，支持 border、th 背景、width 列宽；图片用 `<img src="本地路径|data:|https://…" width="…">`。
- 转换成功后按产物输出规范输出 `【产物:…】` 标记（只标记最终 `.docx`，不得把任何脚本标记为产物）。
- 转换失败时读取错误原因、修正 HTML 后重试，最多重试 2 次；仍失败就如实告知用户，不要假装成功。
- 生成或验证 Word 文档的全过程中，禁止编写/执行任何脚本（.js/.py）：转换是否成功以 `html_to_docx` 的返回结果为准，不要用脚本自检。

## 何时使用
用户请求 Word、.docx、报告、备忘录、信函等文档时，先读取本技能，再按上述规范生成 HTML 并调用工具。
