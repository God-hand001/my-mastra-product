# M7 Word 文档生成引擎 Plan

> 前置:[m7-spec.md](./m7-spec.md) 已确认
> 技术栈:Mastra(后端,TS)+ Python 3.12 embeddable(转换器,随产品打包)+ Electron(桌面壳)

## 架构概览

生成链路对齐参考产品:**agent 写 HTML → 调用转换工具 → Python 转换器产出 .docx**。五个部分:

1. **Python 运行时基础设施**:Windows embeddable 发行版 + 预装依赖,落在 `vendor/python/`,由一键脚本重建;开发与打包用同一套定位逻辑(spec N3)。
2. **转换器 Python 包**(`html_to_docx`):自研,解析 HTML(约定见下)映射为 python-docx 文档,产出 .docx 与结构化结果(JSON)。
3. **Mastra 工具接入**:新建 `html-to-docx` 工具,输入 HTML + 输出路径,内部定位 Python 运行时并调用转换器,返回结构化成功/失败(F1/F5/F9)。
4. **agent 指令更新**:instructions 增加「Word 文档生成规范」——HTML 约定 + 调用规范 + 失败重试上限(F7),禁止再写一次性生成脚本(AC8)。
5. **产物链路复用**:产出的 .docx 走既有 `【产物:…】` 标记与 docx-preview 预览,零改动(N6)。

## HTML 约定(转换器的输入契约)

agent 与转换器之间的全部约定,转换器按此实现,agent 指令按此撰写:

| 能力 | HTML 写法 | 对应 spec |
|------|-----------|-----------|
| 页面设置 | `<head>` 内 `<style>` 的 `@page { size: A4; margin: 2.54cm }`(缺省即 A4 + 常规边距) | F6 |
| 语义分节 | 顶层 `<section>` 一节;每节首段带"段前分页"(首个 section 除外) | F5/F14 |
| 目录 | `<nav data-toc>目录</nav>` 占位,转换时替换为可跳转 TOC 域(收录三级标题);占位段落不落盘,其分页属性移交下一段 | F10/F14 |
| 页眉页脚 | `<meta name="doc-header" content="…">`、`<meta name="doc-footer" content="…">`;页脚支持 `{{page}}`/`{{pages}}` 占位符(→ PAGE/NUMPAGES 域);`<meta name="doc-first-page-plain" content="true">` 首页不带页眉页脚 | F11 |
| 标题/段落/列表 | `h1`–`h3`、`p`、`ul`/`ol`/`li` | F3 |
| 行内样式 | `strong/b`、`em/i`、`u`、`span style="color:…"`、`text-align`、`line-height`、段间距 | F3 |
| 中文字体 | `body { font-family: "宋体", … }` 与元素级覆盖;写入时同时设置 ascii 与 `rFonts.eastAsia` | F2 |
| 表格 | `table/thead/tbody/tr/th/td`,支持 `border`、表头底色(`th` 的 `background`)、`width`(列宽)、单元格 `padding` 与行内样式 | F4 |
| 图片 | `<img src="本地路径|data:image/...;base64,…|https://…">`,`width` 属性或样式定显示宽度;单图失败→占位说明并计入 warnings,不中断 | F12 |
| 标注框 | `<div class="callout" data-type="info|success|warning|danger">…</div>`:背景色 + 左侧色条(用单元格底纹+边框模拟) | F13 |
| 分隔线 | `<hr>` → 横线段落 | F13 |
| 数据卡片 | `<div class="stat-cards"><div class="stat-card"><div class="stat-title">…</div><div class="stat-value">…</div></div>…</div>`,并排成组(用无边框表格布局) | F13 |
| 表格边界 | 分页属性落在表格**前置锚点空段落**上(表格自身无法承载 pageBreakBefore) | F14 |

## 核心数据结构

### 转换器结果契约(Python → stdout JSON)

```jsonc
{
  "ok": true,
  "outputPath": "E:/.../报告.docx",
  "warnings": [ { "kind": "image_failed", "src": "https://…", "reason": "HTTP 404" } ]
}
// 失败时:
{
  "ok": false,
  "error": {
    "kind": "html_parse | unsupported_style | write_failed",  // runtime_missing 由 TS 侧定位时给出
    "message": "人类可读的中文原因",
    "detail": "可选,定位到具体元素/位置"
  }
}
```

转换先写临时文件、成功后改名(spec N5 不留半成品)。

### 运行时定位(src/mastra/services/python-runtime.ts)

```ts
resolvePythonRuntime(): { pythonExe: string; version: string }
// 优先级:env MEW_PYTHON_RUNTIME → <cwd>/vendor/python/python.exe
// 找不到时抛出带明确缺失路径的结构化错误(spec F9),由工具转成给 agent 的可读提示
```

### Mastra 工具(src/mastra/tools/html-to-docx.ts)

```ts
input:  z.object({ html: z.string().min(1), outputPath: z.string().min(1) })
output: { success: true, outputPath, warnings } | { success: false, error }
```

HTML 通过临时 JSON 文件传给转换器(避免命令行长度限制);`outputPath` 做目录合法性校验(复用项目工具的防穿越思路)。

## 模块设计

### 模块 A:Python 运行时基础设施(scripts/setup-python-runtime.mjs + vendor/)

**职责**:一键重建自包含运行时。
**步骤**:下载 embeddable zip 与 get-pip(缓存于 `vendor/_dist/`,已有则跳过)→ 解包到 `vendor/python/` → 改 `python312._pth`(放开 `import site`、加入 `Lib/site-packages`)→ `get-pip.py` 引导 pip → `pip install python-docx html-for-docx beautifulsoup4 lxml Pillow httpx` → 把转换器包拷入 `Lib/site-packages/` → 冒烟验证 `python.exe -c "import docx, bs4, lxml, PIL, httpx"`。
**约定**:`vendor/python/` 与 `vendor/_dist/` 进 `.gitignore`(二进制不入库,脚本能随时重建);转换器源码在 `src/mastra/tools/html_to_docx/`(进 git)。
**打包**:electron-builder `extraResources` 把 `vendor/python` 拷进 `resources/`;`app-desktop/main.js` 拉起后端时注入 `MEW_PYTHON_RUNTIME=<resources>/vendor/python/python.exe`(实现时核实 main.js 拉起后端的具体位置)。
**依赖**:无。

### 模块 B:转换器 Python 包(src/mastra/tools/html_to_docx/)

**职责**:HTML → .docx 全部转换逻辑,自研不抄参考产品代码。
**文件划分**(对齐参考产品的模块化思路,便于演进):
- `converter.py`:主流程(解析 → 遍历映射 → 落盘 → 输出 JSON)
- `page_css.py`:`@page` 与 `<meta name="doc-*">` 解析 → 纸张/边距/页眉页脚
- `section_model.py`:分节队列、段前分页、表格锚点与 TOC 占位移交(F14 两个边界)
- `element_map.py`:标题/段落/列表/行内样式/字体映射(`rFonts.eastAsia` 必设)
- `table_style_applier.py`:表格边框/表头底色/列宽/内边距
- `images.py`:三来源图片获取(本地/base64/httpx),Pillow 探测尺寸,失败占位
- `decorations.py`:标注框/分隔线/数据卡片
- `__main__.py`:`python -m html_to_docx --input <json> ` 入口

**依赖**:模块 A(运行时)。

### 模块 C:TS 工具接入

**C1 运行时定位服务**(`src/mastra/services/python-runtime.ts`):见上方数据结构;开发态 `mastra dev` 的 cwd 即仓库根。
**C2 工具**(`src/mastra/tools/html-to-docx.ts`):`createTool` + zod;子进程调用 `python.exe -m html_to_docx`;stdout JSON 解析;失败把 `error.message + kind` 拼成给 agent 的可读文案(不吞细节,F7 重试依赖它);超时上限(如 60s)防挂死。
**C3 注册**(`src/mastra/index.ts`):工具注册进 agent。
**依赖**:模块 A、B。

### 模块 D:agent 指令(src/mastra/agents/agent.ts)

在「产物输出规范」旁新增「Word 文档生成规范」:
1. 生成 .docx 时**先写完整 HTML**(含上述约定),再调用 `html-to-docx` 工具一次产出;**禁止**编写并执行任何一次性生成脚本(.js/.py)。
2. HTML 约定速查(分节/目录/页眉页脚/装饰组件/图片宽度的写法)。
3. 失败处理:读取错误原因 → 修正 HTML → 重试,**最多 2 次**;仍失败则如实告知用户,不要编造成功。
**依赖**:模块 C。

## 模块交互

```
用户:「帮我生成 XX 报告」
  → agent 写完整 HTML(分节/样式/目录标记)
  → 调用 html-to-docx 工具 { html, outputPath }
  → C1 定位 python.exe(缺失→结构化错误,F9)
  → 子进程 python -m html_to_docx --input tmp.json
  → B 解析 @page/meta → 遍历 section/p 元素映射 → 表格/图片/装饰 → TOC 域 → 落盘
  → stdout JSON
  → 工具返回 { success, outputPath, warnings }
  → agent 回复 + 【产物:名称#路径】标记
  → 既有前端产物卡片 + docx-preview 预览(零改动,N6)
失败分支:工具把 error.kind/message 返回 → agent 按 F7 修正重试(≤2)
```

## 文件组织

```
scripts/setup-python-runtime.mjs        → 新建:运行时一键重建
vendor/python/  vendor/_dist/           → 生成物(gitignore)
src/mastra/tools/html_to_docx/          → 新建:转换器 Python 包(进 git)
src/mastra/services/python-runtime.ts   → 新建:运行时定位
src/mastra/tools/html-to-docx.ts        → 新建:Mastra 工具
src/mastra/index.ts                     → 修改:注册工具
src/mastra/agents/agent.ts              → 修改:Word 文档生成规范
app-desktop/main.js                     → 修改:打包态注入 MEW_PYTHON_RUNTIME
.gitignore                              → 修改:vendor/
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 转换器实现语言 | Python(python-docx 系) | 参考产品同路线;python-docx 的 OOXML 封装成熟,中文字体/域/分节都有现成 API;TS 侧无同级库 |
| 运行时形态 | embeddable + 预装依赖,自包含目录 | 不依赖系统 Python、不污染系统环境(N2);开箱可用(F8) |
| 运行时入库方式 | 二进制 gitignore + 重建脚本 | 仓库不放 50MB+ 二进制;脚本保证任何机器可复现(N3) |
| 定位逻辑 | env 覆盖 → cwd 兜底 | 开发(`mastra dev` cwd=仓库根)与打包(main.js 注入 env)同一套代码(N3) |
| HTML→工具传参 | 临时 JSON 文件 | HTML 可达数十 KB,走 argv 会撞命令行长度限制 |
| 分页实现 | 段前分页属性 + 两个边界处理 | python-docx 无排版引擎,与参考产品同路(spec 关键技术约束);边界处理保证表格/目录场景不丢分页 |
| 装饰组件实现 | 单元格底纹/无边框表格模拟 | python-docx 无原生"文本框卡片",用表格模拟是 Word 兼容性最好的做法 |
| 结果契约 | stdout JSON 单通道 | 工具解析简单;转换日志走 stderr 便于诊断(F9) |
| 图片失败策略 | 占位 + warnings 继续转换 | spec F12 明确要求不中断整篇 |
| pptx/xlsx | 不在本模块(spec 里程碑划分) | 依赖集不同,验收面独立;M7 运行时是它们的公共前置 |

## 待实现时验证的技术细节

1. **embeddable + get-pip**:`python312._pth` 的确切改法(放开 `import site`)在实机验证,失败则换「pip --target 到 site-packages」方案。→ ✅ 已验证,放开 `import site` + 追加 `Lib/site-packages` 即可。
2. **python-docx 域代码**:TOC/PAGE/NUMPAGES 域的 XML 注入写法(`w:fldSimple` vs `w:fldChar`)以实机 Word/WPS 打开效果为准,实现时以 python-docx 实测为准,不凭记忆。→ ✅ 已用 fldChar 复杂域实现,TOC begin 带 dirty 提示更新。
3. **docx-preview 分节切页**:确认其对 `w:pageBreakBefore` 的响应。→ ✅ **已定案(2026-09-15):docx-preview 解析 pageBreakBefore 但不据此切页**,只认显式分页符(w:br type="page")。转换器已改为节首块前插入独立分页符段落(1pt 字号),Word 效果等价、预览器正确分页;存量文档用 scripts/patch_docx_explicit_breaks.py 就地修补。
4. **main.js 拉起后端的位置**:→ ✅ 已核实 main.js 不拉起后端(用户手动启动),cwd 兜底即可,MEW_PYTHON_RUNTIME 留作打包自包含形态的预留注入点。
