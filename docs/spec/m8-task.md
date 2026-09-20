# M8 PPTX 生成 Tasks

> 前置:[m8-spec.md](./m8-spec.md)、[m8-plan.md](./m8-plan.md) 已确认
> 通用约束:同 M7(中文注释/验证输出贴报告/临时文件落盘/不抄参考产品代码)。M7 的 `src/mastra/tools/html_to_docx/` 与 `html-to-docx.ts` 是同构参照,鼓励复用其模式。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `scripts/setup-python-runtime.mjs` | deps 加 python-pptx;拷贝 glob 加 html_to_pptx |
| 新建 | `src/mastra/tools/html_to_pptx/`(Python 包) | 转换器:converter/layout/element_map/decorations/images |
| 新建 | `src/mastra/tools/html-to-pptx.ts` | Mastra 工具 |
| 修改 | `src/mastra/index.ts`、`src/mastra/agents/agent.ts` | 注册 + PPT 生成规范 |
| 修改 | `app/package.json`、`app/src/components/PreviewPanel.tsx`、`app/src/styles/app.css` | pptx 预览 |
| 新建 | `docs/spec/fixtures/m8-deck.html` | 验收 fixture |
| 新建 | `scripts/verify_m8_pptx.py` | A 组断言脚本 |

---

## T1: 运行时扩展 + 转换器骨架

**文件:** `scripts/setup-python-runtime.mjs`、`src/mastra/tools/html_to_pptx/`(`__main__.py`、`converter.py` 骨架)
**依赖:** M7 运行时已就绪

**步骤:**
1. setup 脚本:CORE_DEPS 追加 `python-pptx`;步骤 6 的转换器拷贝改为遍历 `src/mastra/tools/` 下所有 Python 包(html_to_docx、html_to_pptx)。
2. `__main__.py`:复制 M7 同名文件,`convert` 改从 `.converter` 导入;强制 UTF-8 stdio 同款保留。
3. `converter.py` 骨架:任务 JSON 读入 → BeautifulSoup 解析 → 空演示文稿创建(16:9,`slide_width=Inches(13.333)`)→ section 切页循环(先只建页不填内容)→ 结果 JSON 输出 → .tmp 落盘。

**验证:** 重跑 setup 脚本后 `vendor/python/python.exe -c "import pptx; print('pptx-ok')"` 输出 pptx-ok;fixture 最小 HTML 转换产出 4 页空 slide 的 pptx(用 python-pptx 读回页数断言)。

---

## T2: 文本与版式映射

**文件:** `src/mastra/tools/html_to_pptx/layout.py`、`element_map.py`,`converter.py` 接线
**依赖:** T1

**步骤:**
1. `layout.py`:px→英寸换算(÷96);版式坐标——title(标题居中大字+副标题)、content(页标题区+内容区)、two-col(左右两栏,各 45% 宽)、image-full(整页图,标题覆盖);统一页边距(0.5 英寸)。
2. `element_map.py`:`add_textbox(shape)`:h1 页标题(28pt 加粗)/h2(20pt)/h3(16pt)/p(14pt)/两级列表(项目符号,缩进);行内样式(粗/斜/下划线/颜色/字号覆盖);**中文字体双写**:`run.font.name` + XML `rPr/ea` typeface(plan 待验证项 1,写工具函数 `set_run_font_ea`);页标题进 slide.shapes.title(无版式则自建文本框)。
3. 转换器接线:逐 section 按版式建页,遍历子元素映射;溢出不做处理(技能规范约束)。

**验证:** fixture 转换后用 python-pptx 读回断言:页数、各页 shape 数、首 run 字体含 ea typeface、文本内容完整;输出贴报告。

---

## T3: 图片与装饰组件

**文件:** `src/mastra/tools/html_to_pptx/decorations.py`,`images.py`(复用 M7),`converter.py` 接线
**依赖:** T2

**步骤:**
1. 图片:导入(或复制)M7 `html_to_docx/images.py`;块级 img 按版式铺放(image-full 铺满内容区等比;内容页按 width 换算);行内 img 忽略宽度放当前位置(降级为块级,报告注明);失败→灰底占位矩形+warnings(同 M7 语义)。
2. 数据卡片:`stat-cards` → n 个圆角矩形横向均分,标题小灰字+数值大号加粗;标注框 `callout` → 全宽圆角矩形,按 data-type 配色(同 M7 色板);`hr` → 细横线形状。
3. 组件内文字走 T2 的行内渲染。

**验证:** fixture(m8-deck.html:含 4 页——标题页/内容页/两栏/卡片+标注框页,三来源图片)转换断言:图片 2 张内嵌、404 → warnings 恰 1 条、卡片/标注框 shape 存在且坐标在页内;输出贴报告。

---

## T4: Mastra 工具 + agent 规范

**文件:** `src/mastra/tools/html-to-pptx.ts`(新建)、`src/mastra/index.ts`、`src/mastra/agents/agent.ts`(修改)
**依赖:** T3

**步骤:**
1. 工具:复制 html-to-docx.ts 改造(工具 id `html_to_pptx`、调用 `-m html_to_pptx`、描述写 PPT 版 HTML 约定速查——**参照 M10 教训,描述里直接给强制 HTML 骨架示例**:section=页/data-layout/组件)。
2. `index.ts` 注册;agent.ts「PPT 生成规范」段(要点≤6/页、版式标记、重试≤2、禁一次性脚本、产物标记)。

**验证:** 根 `npx tsc --noEmit` 通过;临时脚本直调工具:合法 HTML→success 落盘;畸形→中文错误;`grep 'html_to_pptx' src/mastra/agents/agent.ts` 命中。

---

## T5: pptx 预览

**文件:** `app/package.json`、`app/src/components/PreviewPanel.tsx`、`app/src/styles/app.css`
**依赖:** T1(产物可测即可,与 T4 并行可)

**步骤:**
1. `cd app && npm i pptx-preview`;读其 d.ts 确认 API(plan 待验证项 2:命令式 init 还是组件;slide DOM 结构)。
2. PreviewPanel 文件类型路由加 `pptx` 分支:按 M7 docx 分支模式封装容器,init 渲染、宽度适配(量渲染出的 slide 实际元素,量不到不缩放——吸取 docx 教训);加载态/错误态与 docx 分支一致。
3. app.css:pptx 容器/分页间距样式,配色沿用设计令牌。

**验证:** `cd app && npx tsc --noEmit` 与 `npm run build` 通过;dev 页面手动打开 T3 产出的 pptx 预览:按 slide 分页渲染、无宽度溢出(截图或描述进报告)。

---

## T6: 断言脚本与端到端

**文件:** `scripts/verify_m8_pptx.py`(新建)
**依赖:** T1–T5

**步骤:**
1. 断言脚本(参照 verify_m7_converter.py 组织):AC1 页数/内容、AC2 eastAsia、AC3 版式坐标、AC4 图片与 warnings、AC6 失败分类+无残件。
2. 端到端:真实对话「生成一份 5 页的嘉立创产品介绍 PPT,含封面、数据卡片」;观察 HTML+一次工具调用、无临时脚本、产物卡片、预览分页(AC7);M7/浏览器回归(AC8)。

**验证:** 断言全绿;端到端报告对照 m8-checklist.md 勾验。

---

## 执行顺序

T1 → T2 → T3 → T4 → T5(可与 T2-T4 并行) → T6
