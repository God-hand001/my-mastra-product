# M8 PPTX 生成 Spec

> 产品:嘉立创办公(基于 Mastra harness)
> 前置:M7 已交付产品内 Python 运行时(vendor/python)与"agent 写 HTML → Python 转换器"路线;本模块复用之
> 调研:参考产品 tencent-pptx 插件(2 个文件/738 行,python-pptx 路线)

## 背景

M7 解决了 Word 生成,但用户同样需要 PPT。生成 PPT 的老路(让模型写一次性脚本)已在 M7 被否定。本模块沿用 M7 确认的路线:**agent 写 HTML → 调用工具 → Python 转换器(python-pptx)产出 .pptx**;同时补上预览侧缺口——当前预览栈(docx-preview/SheetJS/pdfjs)唯独不能渲染 pptx,参考产品使用 pptx-preview 库。

## 关键技术约束

python-pptx 同样没有排版引擎:不能"根据文字多少自动缩排/自动换页"。一页 slide 的容量由模板版式与字号决定,**超出会溢出**。因此:
- 每页内容量靠技能规范约束(agent 侧:每页要点 ≤6 条等)
- 转换器不做内容裁切,溢出由 agent 修正重试
与 M7 的"语义分节分页"一样,这是与用户达成的共识边界。

## 目标

- G1:agent 生成 PPT 走「HTML + 一次工具调用」,无一次性脚本
- G2:中文字体正确(python-pptx 同样要处理 eastAsia 字体)
- G3:每页 slide 位置可预期(HTML 分节即分页)
- G4:右侧预览面板能渲染 .pptx
- G5:失败时 agent 拿到可读原因并修正重试

## 功能需求

- **F1 转换工具**:`html-to-pptx` 工具,输入完整 HTML + 输出路径(workspace 相对),产出 .pptx;成功返回路径,失败返回结构化中文原因(html_parse/unsupported_style/write_failed/runtime_missing),契约与 M7 一致
- **F2 页面结构**:每个顶层 `<section>` = 一页 slide;首个 section 缺省为标题页版式(大标题+副标题),其余为内容页;`<section data-layout="title|content|two-col|image-full">` 可显式指定版式
- **F3 文本样式**:h1(页标题)/h2-h3、p、两级列表、加粗/斜体/下划线、文字颜色、字号(span style font-size)、对齐;中文字体写入 eastAsia(复用 M7 的 set_run_font 思路);文档级字体取 body font-family,缺省"微软雅黑"
- **F4 图片**:本地路径/base64/远程 URL 三来源;width 指定显示宽度;单图失败→占位框+warnings,不中断(F12 同款约定)
- **F5 装饰组件**:数据卡片(stat-cards→圆角矩形形状并排)、标注框(callout→底色圆角矩形)、分隔线(hr→横线形状)
- **F6 页面设置**:缺省 16:9(13.33×7.5 英寸);`@page { size: 1280px 720px }` 可指定像素尺寸(换算英制)
- **F7 运行时复用**:python-pptx 安装进 M7 的 vendor/python(setup 脚本扩展依赖清单),转换器包同机制拷贝;不新建运行时
- **F8 pptx 预览**:app 增加 `pptx-preview` 依赖(参考产品同款);PreviewPanel 新增 pptx 标签分支,按 slide 分页渲染
- **F9 agent 规范**:instructions 增补「PPT 生成规范」——HTML 约定速查+失败重试 ≤2+禁一次性脚本(与 M7 同款条款);生成后按产物规范输出标记

## 非功能需求

- **N1 离线可用**(转换阶段)
- **N2 不留残件**:失败无半成品;转换用临时文件改名落盘(同 M7 N5)
- **N3 性能**:常规 20 页内 pptx 转换秒级
- **N4 回归**:既有 Word/浏览器/预览链路不受影响

## 不做的事

- 逐元素精确还原网页布局(pptx 是版式化文档,不是网页截图)
- 动画、演讲者备注(fallback:正文里写不进)、母版/主题定制、图表对象(pptx 原生 chart——一期用图片或表格替代,有需求另立)
- 自动排版(同 M7 约束)
- pptx 的二次编辑

## 验收标准

- **AC1**:含 4 页(标题页+两内容页+数据卡片页)的 HTML 转换后,PowerPoint 或 WPS 正常打开,页数与内容对应
- **AC2**:中文字符显示为指定字体(检查 XML 含 eastAsia 字体设置)
- **AC3**:标题页/内容页/两栏版式呈现正确;列表层级正确
- **AC4**:三来源图片正确嵌入;width 生效;404 图→占位+warnings 恰 1 条
- **AC5**:右侧预览面板按 slide 分页渲染,与 Word 侧预览体验一致
- **AC6**:转换失败返回可读中文原因;输出目录无半成品
- **AC7**:真实对话让 agent 生成 5 页 PPT:行为为「HTML+一次工具调用」,无临时脚本,产物卡片+预览可用
- **AC8**:M7 Word 生成、浏览器、既有预览回归正常
