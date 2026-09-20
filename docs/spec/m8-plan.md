# M8 PPTX 生成 Plan

> 前置:[m8-spec.md](./m8-spec.md) 已确认;复用 M7 全部基础设施(vendor/python 运行时、工具模式、错误契约、临时文件落盘)
> 技术栈:python-pptx(M8 新增依赖)+ pptx-preview(前端)

## 架构概览

与 M7 完全同构,差异只在转换器目标格式与 HTML 约定:

```
agent 写 HTML(section=页) → html-to-pptx 工具 → python-pptx 转换器 → .pptx
  → 产物标记 → pptx-preview 预览(新增分支)
```

复用不重建:运行时定位(services/python-runtime.ts)、任务 JSON 传参、stdout 单行 JSON 契约、错误分类、.tmp 改名落盘、工具防穿越——全部照 M7 模式。

## HTML 约定(转换器输入契约)

| 能力 | HTML 写法 | spec |
|------|-----------|------|
| 页面 | 顶层 `<section>` 一页;`data-layout="title|content|two-col|image-full"`(缺省:首页 title 余 content) | F2 |
| 页面尺寸 | `@page { size: 1280px 720px }`(缺省 1280×720 = 16:9) | F6 |
| 标题/正文 | `h1`(页标题)/`h2`/`h3`/`p`/`ul`/`ol`(两级) | F3 |
| 行内 | strong/b、em/i、u、span style(color/font-size/font-family) | F3 |
| 中文字体 | `body { font-family: "微软雅黑" }`;run 级同时写 latin+ea typeface | F3 |
| 图片 | `<img src="本地|data:|https://…" width="…">`(三来源+失败降级,复用 M7 images.py 思路) | F4 |
| 数据卡片 | `<div class="stat-cards">…` → 圆角矩形形状组 | F5 |
| 标注框 | `<div class="callout" data-type="…">` → 底色圆角矩形 | F5 |
| 分隔线 | `<hr>` → 横线形状 | F5 |

## 模块设计

### 模块 A:转换器 Python 包(src/mastra/tools/html_to_pptx/)

- `__main__.py`:CLI 入口(契约同 M7,utf-8 强制)
- `converter.py`:主流程——按 section 切页、版式选择、逐元素映射、落盘(.tmp 改名)
- `element_map.py`:文本框创建与行内样式(python-pptx 的 run 字体:latin 用 `font.name`,eastAsia 需操作 `rPr` 的 `ea` typeface XML——**实现时以 python-pptx 实测为准**)
- `layout.py`:版式计算——1280×720px→英寸换算(÷96);标题区/内容区边距;two-col 左右分栏坐标;图片等比缩放与居中
- `decorations.py`:卡片/标注框/分隔线 → 圆角矩形+文本框组合
- `images.py`:直接**复用 M7 包的 images.py**(跨包 import 或复制,实现时取导入方式)
- **依赖清单**:`scripts/setup-python-runtime.mjs` 的 CORE_DEPS 追加 `python-pptx`;setup 脚本第 6 步拷贝转换器的 glob 扩展为 `html_to_docx` 与 `html_to_pptx` 两个包

### 模块 B:Mastra 工具(src/mastra/tools/html-to-pptx.ts)

照 M7 html-to-docx.ts 模式:zod 输入、防穿越(workspace 根)、临时 JSON、子进程调用 `-m html_to_pptx`、60s 超时、结果 JSON 解析、错误中文化。可大量复制 M7 文件改调用目标(实现时注明同源)。

### 模块 C:pptx 预览(app/src)

- `app/package.json` 加 `pptx-preview`
- `PreviewPanel.tsx`:文件类型路由加 pptx 分支;渲染容器(参考产品同款库),按 slide 分页;宽度适配量 stage 实际尺寸(吸取 M7 docx 宽度适配教训)
- 样式:app.css 增 pptx 容器/工具栏

### 模块 D:agent 规范(agents/agent.ts)

instructions 的 Word 规范旁新增「PPT 生成规范」:HTML 约定速查(每页一个 section、每页要点≤6 条、版式标记、组件用法)+失败重试≤2+禁一次性脚本。

## 文件组织

```
src/mastra/tools/html_to_pptx/          → 新建:转换器 Python 包(5 文件)
src/mastra/tools/html-to-pptx.ts        → 新建:Mastra 工具
scripts/setup-python-runtime.mjs        → 修改:deps+拷贝 glob
src/mastra/index.ts / agents/agent.ts   → 修改:注册+规范
app/package.json                        → 修改:pptx-preview
app/src/components/PreviewPanel.tsx     → 修改:pptx 分支
app/src/styles/app.css                  → 修改:pptx 样式
docs/spec/fixtures/m8-*.html            → 新建:验收 fixture
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 生成路线 | HTML→python-pptx(同 M7) | 模型写结构化 HTML 是其擅长;与 Word 同构,工具/错误/运行时全复用 |
| slide 划分 | 顶层 section | 与 M7 语义分节一致,模型零学习成本 |
| 版式 | data-layout 四种 | 覆盖标题页/常规/两栏/大图;python-pptx 自建文本框坐标,不依赖Office内置版式(跨平台稳定性好) |
| 中文字体 | latin+ea typeface 双写 | M7 实证:漏 ea 必回退 |
| 预览 | pptx-preview | 参考产品同款;纯前端渲染 |
| 单位制 | HTML 用 px,内部换算英寸 | 模型对 px 直觉准;96dpi 换算固定 |
| 图表对象 | 一期不做(spec) | python-pptx 图表 API 复杂,验收面爆炸;用表格/图片替代 |

## 待实现时验证的技术细节

1. **python-pptx 中文字体**:`rPr/ea` typeface 的 XML 写法与 WPS/PowerPoint 实际渲染效果(实机验证,参考 M7 eastAsia 坑)。
2. **pptx-preview API**:库的导出形态(React 组件 vs 命令式 init)、slide 分页 DOM 结构、宽度适配方式(npm 装后读 d.ts)。
3. **python-pptx 安装**:确认 pip 清华源可装、与 vendor/python 3.12 兼容。
4. **图片大小限制**:大图(>2MB)base64 的任务 JSON 体积——必要时转换器接受文件路径引用替代 data URI(实测后定)。
