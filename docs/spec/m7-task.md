# M7 Word 文档生成引擎 Tasks

> 前置:[m7-spec.md](./m7-spec.md)、[m7-plan.md](./m7-plan.md) 已确认
> 通用约束:Python 代码一律中文注释;每个任务的验证输出要贴进完成报告;`vendor/python/` 与 `vendor/_dist/` 不进 git;转换器不得复制参考产品(腾讯)代码,只用 PyPI 开源库自行实现。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `scripts/setup-python-runtime.mjs` | 运行时一键重建(下载/解包/pip 依赖/拷贝转换器/冒烟) |
| 修改 | `.gitignore` | 忽略 `vendor/python/`、`vendor/_dist/` |
| 新建 | `src/mastra/tools/html_to_docx/`(Python 包) | 转换器:converter / page_css / section_model / element_map / table_style_applier / images / decorations / `__main__` |
| 新建 | `src/mastra/services/python-runtime.ts` | 运行时定位(env 覆盖 → cwd 兜底) |
| 新建 | `src/mastra/tools/html-to-docx.ts` | Mastra 工具:HTML+输出路径 → 子进程转换 → 结构化结果 |
| 修改 | `src/mastra/index.ts` | 注册工具 |
| 修改 | `src/mastra/agents/agent.ts` | instructions 增加「Word 文档生成规范」 |
| 修改 | `app-desktop/main.js` | 打包态注入 `MEW_PYTHON_RUNTIME` |

---

## T1: Python 运行时落地

**文件:** `scripts/setup-python-runtime.mjs`(新建)、`.gitignore`(修改)
**依赖:** 无

**步骤:**
1. `.gitignore` 追加 `vendor/python/` 与 `vendor/_dist/`。
2. 脚本流程(全部可重复执行,已有产物则跳过对应步骤):下载 `python-3.12.10-embed-amd64.zip` 与 `get-pip.py` 到 `vendor/_dist/`(python.org 官方源)→ 解包 zip 到 `vendor/python/` → 编辑 `python312._pth`:取消 `import site` 注释、追加 `Lib/site-packages` → `python.exe get-pip.py` → `python.exe -m pip install python-docx html-for-docx beautifulsoup4 lxml Pillow httpx`(如某包在 PyPI 不存在,记录并在报告中说明,转换器相应降级)→ 拷贝 `src/mastra/tools/html_to_docx/` 到 `vendor/python/Lib/site-packages/`(T1 阶段先建含 `__init__.py` 的空包)。
3. 脚本最后冒烟:打印 `python.exe --version` 与依赖导入结果。

**验证:** 执行 `node scripts/setup-python-runtime.mjs` 成功;`vendor/python/python.exe -c "import docx, bs4, lxml, PIL, httpx; print('runtime-ok')"` 输出 `runtime-ok`。

---

## T2: 转换器核心 —— 主流程 + 基础元素映射

**文件:** `src/mastra/tools/html_to_docx/`:`__main__.py`、`converter.py`、`element_map.py`
**依赖:** T1

**步骤:**
1. `__main__.py`:`--input <json 文件>` 入口,JSON 含 `{ html, outputPath, options? }`;读入后交 `converter.convert`,结果 JSON 打到 stdout(契约见 plan),异常兜底为 `{ ok:false, error:{ kind, message } }`,任何路径都保证 stdout 只有一行 JSON。
2. `element_map.py`:标题 `h1–h3` → Heading 1–3;`p` → 段落;`ul/ol/li` → List Bullet / List Number(嵌套列表支持两级);行内:`strong/b`、`em/i`、`u`、`span style="color:…"`;段落对齐 `text-align`、`line-height`、段间距(`margin`)。
3. **中文字体(F2)**:文档级默认字体取 `body` 的 `font-family` 第一个中文字体;每个 run 同时设置 ascii 字体与 `rFonts` 的 `eastAsia`(python-docx 需直接操作 `rPr/rFonts` XML,写成工具函数 `set_run_font`);元素级(`h1`、`span` 等)覆盖文档级。
4. 失败分类:HTML 无法解析 → `html_parse`;遇到确定不支持的构造 → `unsupported_style`(带元素定位 detail);写文件异常 → `write_failed`。
5. 落盘:先写 `<outputPath>.tmp`,成功后改名,失败删除临时文件(N5)。

**验证:** 写 `docs/spec/fixtures/m7-basic.html`(标题三级 + 段落 + 两级列表 + 加粗斜体下划线 + 颜色 + 居中 + 中文宋体),用 `vendor/python/python.exe -m html_to_docx --input tmp.json` 转换;用另一段临时 Python 脚本打开产出的 docx 断言:段落数、Heading 样式名、首个正文 run 的 `rFonts` 含 eastAsia 且值为宋体;把断言输出贴进报告。

---

## T3: 表格样式

**文件:** `src/mastra/tools/html_to_docx/table_style_applier.py`
**依赖:** T2

**步骤:**
1. `table/thead/tbody/tr/th/td` → python-docx 表格;应用:`border`(全边框,取 `border` 属性或内联样式,缺省细实线)、表头底色(`th` 的 `background`,用 `w:shd` 底纹)、列宽(`width` 属性/样式,cm 或 px→cm 换算)、单元格内边距(`padding` → `w:tcMar`)、单元格内文字行内样式沿用 T2。
2. 表格内嵌段落对齐/加粗等复用 element_map 的行内处理,不重复实现。

**验证:** 扩充 fixture 为 `m7-table.html`(3 列表格:表头底色 + 指定列宽 + 边框),转换后用脚本断言:表格存在、表头单元格 `w:shd` 填充色正确、列宽与设定一致(允许换算误差),输出贴进报告。

---

## T4: 分节分页 + 目录 + 页面设置 + 页眉页脚

**文件:** `src/mastra/tools/html_to_docx/section_model.py`、`page_css.py`,`converter.py` 接线
**依赖:** T2

**步骤:**
1. `page_css.py`:解析 `@page { size; margin }`(仅支持 A4/Letter 与 cm/mm/in/px,超出→`unsupported_style`);解析 `<meta name="doc-header|doc-footer|doc-first-page-plain">`。
2. `section_model.py`:顶层 `<section>` 切分文档流;每节首段加"段前分页"(`w:pageBreakBefore`),首个 section 除外。**两个边界**(F14):节首元素是表格 → 属性落到前置锚点空段落;节首是 TOC 占位 → 占位段落本身不落盘,属性移交紧随其后的下一段。
3. 目录(F10):`<nav data-toc>…</nav>` → 删除占位文本,插入 TOC 域(`\o "1-3"` 收录三级标题,可跳转);域 XML 写法以实机验证为准(plan 待验证项 2)。
4. 页眉页脚(F11):header/footer 内容写入;`{{page}}`/`{{pages}}` → PAGE/NUMPAGES 域;`doc-first-page-plain=true` → 首页不同且首页眉脚留空。
5. 纸张/边距(F6):写入 sectPr,缺省 A4 + 上下 2.54cm / 左右 3.18cm。

**验证:** fixture `m7-sections.html`(三个 section + 目录标记 + meta 页脚含 `{{page}}`),转换后脚本断言:非首节首段 XML 含 `pageBreakBefore`、含 TOC 域指令、sectPr 纸张为 A4、footer 含 PAGE 域;**并在 Word/WPS 中实际打开确认目录与页码可见**(人工,结果记入报告)。

---

## T5: 图片 + 装饰组件

**文件:** `src/mastra/tools/html_to_docx/images.py`、`decorations.py`
**依赖:** T2、T4

**步骤:**
1. `images.py`:三来源 —— 本地路径(相对路径基于输出文件目录解析)、`data:image/...;base64`、`http(s)://`(httpx 下载,10s 超时);Pillow 读尺寸并按 `width`(属性或样式,px/cm)等比设定;任一失败 → 该处插入灰色占位段落「[图片加载失败: 原因]」,`warnings` 追加 `{ kind:'image_failed', src, reason }`,继续转换(F12)。
2. `decorations.py`:标注框 `<div class="callout" data-type="…">` → 单格表格,底纹色按类型(info 蓝/success 绿/warning 橙/danger 红)+ 左侧色条(左边框加粗着色);`<hr>` → 底边框横线段落;`stat-cards`/`stat-card`(含 `stat-title`/`stat-value`) → 无边框表格并排布局,数值加大加粗。
3. 组件内文字样式复用 element_map。

**验证:** fixture `m7-rich.html`(本地图片 + base64 小图 + 一个故意 404 的远程图 + 标注框×2 + hr + 数据卡片组),转换后脚本断言:成功返回、warnings 恰含 1 条 image_failed、文档含 2 张内嵌图;输出贴进报告。

---

## T6: TS 接入 —— 运行时定位 + Mastra 工具

**文件:** `src/mastra/services/python-runtime.ts`、`src/mastra/tools/html-to-docx.ts`、`src/mastra/index.ts`
**依赖:** T1–T5

**步骤:**
1. `resolvePythonRuntime()`:`MEW_PYTHON_RUNTIME` env → `<cwd>/vendor/python/python.exe`;存在性校验,缺失时抛中文结构化错误,明确写出尝试过的路径(F9);附 `--version` 快速校验。
2. 工具 `html-to-docx`:`createTool` + zod `{ html: string, outputPath: string }`;`outputPath` 目录校验(防穿越,参考 project-tools 既有做法);HTML+路径写临时 JSON(os tmpdir);`spawn` 调 `python.exe -m html_to_docx --input …`,60s 超时 kill;解析 stdout JSON;成功返回 `{ success:true, outputPath, warnings }`,失败把 `error.kind` 映射为中文类别 + 原始 message 一并返回给 agent(F5/F7);`runtime_missing` 单独文案提示环境损坏。
3. `index.ts` 注册工具;`npx tsc --noEmit` 通过。

**验证:** 根目录 `npx tsc --noEmit` 通过;临时脚本直接调用工具层:合法 HTML → success 且文件落盘;畸形 HTML → 返回含 kind/message 的失败;`MEW_PYTHON_RUNTIME` 指向不存在路径 → 返回 runtime_missing 文案。输出贴进报告。

---

## T7: agent 指令(Word 文档生成规范)

**文件:** `src/mastra/agents/agent.ts`
**依赖:** T6

**步骤:**
1. instructions 在「产物输出规范」旁新增「Word 文档生成规范」段落:
   - 生成 .docx:先写完整 HTML(按约定速查:section 分节/nav data-toc 目录/meta 页眉页脚/callout 与 stat-cards 组件/图片 width),然后**调用一次** `html-to-docx`;**禁止**编写或执行任何一次性生成脚本(js/py);
   - 生成后用 `【产物:名称#路径】` 标记产出(沿用既有规范);
   - 失败时读错误原因修正 HTML 重试,最多 2 次,仍失败如实告知。
2. 篇幅控制在指令其余段落的同级粒度,不展开 python 细节。

**验证:** `grep 'html-to-docx' src/mastra/agents/agent.ts` 命中;根 `npx tsc --noEmit` 通过。

---

## T8: 打包配置 + 端到端验证

**文件:** `app-desktop/package.json`(已核实:main.js 不拉起后端,4111 由用户手动启动,无 spawn 注入点)
**依赖:** T6

**步骤:**
1. ~~main.js spawn env 注入~~ **已按实况修正**:后端手动启动,cwd=仓库根,定位逻辑的 cwd 兜底即可覆盖开发态与当前打包形态;`MEW_PYTHON_RUNTIME` env 保留,作为将来后端随产品自包含启动的预留注入点。
2. `app-desktop/package.json` 的 `build.extraFiles` 增加 `../vendor/python → vendor/python`(运行时随安装包分发,F8)。
3. 端到端:启动后端与前端,真实对话「生成一份三章节的项目报告,含目录、页码页脚、一个表格、一个数据卡片」;观察:agent 产出 HTML + 一次工具调用、工作区无 `gen_*.js`/`verify_*.py` 残留(AC8)、产物卡片出现、右侧预览正常渲染分节切页(AC6)、失败重试路径可用(可让 agent 第二次故意给坏 HTML 触发一次失败观察重试)。
4. 对照 `m7-checklist.md` 逐项勾验。

**验证:** 全流程截图/记录进报告;`node --check app-desktop/main.js` 通过。

---

## 执行顺序

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8

T2–T5 为同一 Python 包,由一个执行者连续完成;T6–T7(TS 侧)可在 T5 验证通过后并行准备,但注册与端到端必须等转换器就绪。
