# M8 PPTX 生成 — codex 执行任务书

你是本仓库(Mastra+React 产品)的实现工程师。先通读以下文件再动手:

- docs/spec/m8-task.md、docs/spec/m8-plan.md、docs/spec/m8-spec.md(需求与验收)
- M7 同构参照:src/mastra/tools/html_to_docx/(Python 包)、src/mastra/tools/html-to-docx.ts(工具)、app/src/components/PreviewPanel.tsx 的 docx 分支、scripts/verify_m7_converter.py(断言组织方式)

## 环境事实(已由主管准备,不要重复做)

- vendor/python 运行时就绪,`python-pptx` 已安装(`vendor/python/python.exe -c "import pptx"` 通过)。
- scripts/setup-python-runtime.mjs 已支持把 src/mastra/tools/ 下的 html_to_pptx、xlsx_recalc 包拷入运行时(目录不存在则跳过)。**禁止修改本脚本**。你建好包之后重跑 `node scripts/setup-python-runtime.mjs` 即可同步进运行时(幂等)。
- app/ 已安装 pptx-preview@1.0.7,**禁止再 npm i**。其 API(d.ts 摘录):
  - `import { init } from 'pptx-preview'`;`const previewer = init(dom: HTMLElement, options: { width?: number; height?: number; mode?: 'list' | 'slide' })`
  - `await previewer.preview(file: ArrayBuffer)`;`previewer.slideCount`;`previewer.destroy()`

## 执行范围(对应 m8-task.md)

1. **T1**:`src/mastra/tools/html_to_pptx/` 包骨架(`__init__.py`、`__main__.py`、`converter.py`)。`__main__.py` 复制 M7 同名文件,`convert` 改从 `.converter` 导入;保留强制 UTF-8 stdio(Windows 子进程 stdout 默认 GBK,必须 reconfigure,这是 M7 实证坑)。任务 JSON 读入 → BeautifulSoup 解析 → 16:9 空演示文稿(slide_width=Inches(13.333))→ section 切页循环(先只建页)→ 结果 JSON → .tmp 落盘。用最小 HTML 验证页数。
2. **T2**:`layout.py`(px→英寸 ÷96;title/content/two-col/image-full 四版式坐标;页边距 0.5 英寸)、`element_map.py`(h1 28pt/h2 20pt/h3 16pt/p 14pt、两级列表缩进、行内样式、`set_run_font_ea` 中文字体双写、页标题进 slide.shapes.title)。
   中文字体 eastAsia 写法提示(pptx 是 DrawingML):`run.font.name` 只写 a:latin;需要再往 `a:rPr` 下追加 `<a:ea typeface="微软雅黑"/>`,可用 `from pptx.oxml.ns import qn`,`rPr = run._r.get_or_add_rPr()`,`ea = rPr.makeelement(qn('a:ea'), {'typeface': 字体名})`,记得同时处理缺 a:latin 时补 latin。
3. **T3**:`decorations.py`(stat-cards 圆角矩形横排/callout 按 data-type 配色/hr 横线)、`images.py`(M7 的 html_to_docx/images.py 若与 python-docx 类型耦合就复制改造并在文件头注明同源,否则跨包 import);块级/行内图片、404→灰底占位+warnings。
4. **T4(仅工具文件)**:新建 `src/mastra/tools/html-to-pptx.ts`(复制 html-to-docx.ts 改造:工具 id `html_to_pptx`、子进程 `-m html_to_pptx`、60s 超时、错误中文化、防穿越)。**工具 description 里必须直接给强制 HTML 骨架示例**(M7 教训:小模型对骨架示例遵从远好于条款),骨架含 section/data-layout/stat-cards/callout 用法。fixture `docs/spec/fixtures/m8-deck.html` 一并创建(4 页:标题页/内容页/两栏/卡片+标注框页,三来源图片:本地/https/data:)。
5. **T5**:PreviewPanel.tsx 文件类型路由加 `pptx` 分支,按 docx 分支模式封装容器;init 后 preview(ArrayBuffer);宽度适配先量渲染出的 slide 实际元素,量不到不缩放(吸取 docx 教训);加载/错误态与 docx 分支一致。样式写进**新文件** `app/src/styles/preview-pptx.css` 并在 PreviewPanel.tsx 顶部 import(配色沿用 app.css 既有设计令牌的变量名)。
6. **T6**:`scripts/verify_m8_pptx.py`(参照 verify_m7_converter.py 组织:A1 运行时/A2 页数/A3 文本/A4 eastAsia/A5 版式坐标/A6 图片与 warnings/A7 组件/A8 工具/A9 防穿越/A11 失败无残件),用 `vendor/python/python.exe` 跑到全绿。

## 禁改文件(主管并行编辑中,动则冲突)

- src/mastra/agents/agent.ts、src/mastra/index.ts(工具注册与 agent 规范由主管完成)
- scripts/setup-python-runtime.mjs
- app/src/styles/app.css、app/package.json
- app/src 下除 PreviewPanel.tsx 与你新建的 preview-pptx.css 之外的任何文件

若 `cd app && npx tsc --noEmit` 报出上述禁改文件的错误,忽略即可(主管并行编辑造成),只对你自己的文件负责。禁止 git commit,禁止启动 dev 服务,所有命令注意防交互挂起。

## 验证纪律

- 每个任务的验证输出(命令+关键输出行)保留,最终一次性汇总输出。
- 转换器迭代调试时:改完包代码重跑 `node scripts/setup-python-runtime.mjs` 同步,或测试命令临时加 `PYTHONPATH=src/mastra/tools`。
- 根目录 `npx tsc --noEmit` 必须无输出(你的 html-to-pptx.ts 是根 tsconfig 一部分)。
- 完成标志:verify_m8_pptx.py 全绿 + fixture 转换产物落盘 + 根 tsc 干净 + app tsc 对你的文件无错。

全程中文注释与中文错误文案。现在开始,按 T1→T6 顺序执行。
