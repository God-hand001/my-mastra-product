# M6 内置浏览器 Tasks

> 前置:[m6-spec.md](./m6-spec.md)、[m6-plan.md](./m6-plan.md) 已确认
> Electron API 已核实(基于 app-desktop/node_modules/electron/electron.d.ts,Electron 33.4.11):
> - `WebPreferences.webviewTag?: boolean` 存在
> - `<webview>` 的 `webpreferences` 属性是**逗号分隔字符串**(如 `"nodeIntegration=no,contextIsolation=yes"`),`yes/1` 为真、`no/0` 为假
> - 新窗口拦截用 `setWindowOpenHandler`,返回 `{ action: 'deny' }`(旧的 `new-window` 事件已废弃)
> - `did-fail-load` 回调签名:`(event, errorCode, errorDescription, validatedURL, isMainFrame, ...)`
> - `canGoBack()` / `canGoForward()` / `goBack()` / `goForward()` / `reload()` / `stop()` / `loadURL()` / `executeJavaScript()` 均可用

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `app/src/lib/urlInput.ts` | 地址输入解析、协议白名单、搜索地址模板 |
| 修改 | `app/src/lib/artifacts.ts` | 追加 `parseWebPages` / `stripWebPageMarkers` |
| 修改 | `app-desktop/main.js` | 开启 `webviewTag`;对 webview 施加导航与新窗口约束 |
| 新建 | `app/src/components/BrowserPreview.tsx` | 地址栏 + 导航控件 + webview + 降级提示 + 交给 agent |
| 修改 | `app/src/components/PreviewPanel.tsx` | browser 标签类型、常驻挂载、TabIcon、新标签页地址栏 |
| 修改 | `app/src/routes/TaskPage.tsx` | `openBrowserTab`、事件监听、历史与流式扫描 |
| 修改 | `app/src/components/AssistantSteps.tsx` | 网页卡片渲染 + 标记清洗 |
| 修改 | `app/src/components/ChatThread.tsx` | 监听 `h0-fill-composer` 填入输入框 |
| 修改 | `src/mastra/agents/agent.ts` | instructions 增加「网页引用规范」 |
| 修改 | `app/src/styles/app.css` | 地址栏、导航按钮、webview 容器、降级提示、网页卡片样式 |

---

## T1: 地址输入解析模块

**文件:** `app/src/lib/urlInput.ts`(新建)
**依赖:** 无

**步骤:**
1. 定义 `UrlResolution` 联合类型:`{ kind: 'url'; url: string }`、`{ kind: 'search'; url: string }`、`{ kind: 'rejected'; reason: string }`。
2. 定义搜索地址模板常量,导出便于后续替换(用必应:`https://www.bing.com/search?q=` + `encodeURIComponent(关键词)`)。
3. 实现 `resolveUrlInput(raw: string): UrlResolution`,判定顺序:
   - 去首尾空白;空串返回 `rejected`(理由「请输入网址或关键词」)。
   - 若含 `://`:用 `new URL()` 解析,协议为 `http:` / `https:` 返回 `url`,否则返回 `rejected`(理由说明只支持 http/https);解析抛错也返回 `rejected`。
   - 若以 `javascript:`、`data:`、`file:` 等开头(无 `//` 的伪协议形态,如 `javascript:alert(1)`):返回 `rejected`。注意这类字符串不含 `://`,必须单独判断,否则会被当成关键词送去搜索。
   - 若匹配「含点、无空格、点后至少 2 个字母」的域名形态(如 `mastra.ai`、`example.com/path`):补 `https://` 后返回 `url`。
   - 其余作为关键词,返回 `search`。
4. 为每条分支写中文注释说明判定依据。

**验证:** 在 `app` 目录执行 `npx tsc --noEmit` 通过;并用 node 起一段临时脚本(或临时测试文件,验证后删除)对下列输入逐个断言,把实际输出贴进完成报告:
`mastra.ai` → url `https://mastra.ai`;`https://a.com` → url;`mastra 框架` → search;`javascript:alert(1)` → rejected;`file:///C:/` → rejected;`  `(空白) → rejected。

---

## T2: 网页标记解析

**文件:** `app/src/lib/artifacts.ts`(修改)
**依赖:** T1

**步骤:**
1. 参照文件内既有的 `ARTIFACT_PATTERN`(`/【产物:(.+?)#(.+?)】/g`)与 `parseArtifacts` / `stripArtifactMarkers` 的写法,新增 `WEBPAGE_PATTERN`(`/【网页:(.+?)#(.+?)】/g`)。
2. 导出 `WebPage` 类型(`{ title: string; url: string }`)与 `parseWebPages(text: string): WebPage[]`:对每个匹配的 url 调用 T1 的 `resolveUrlInput`,**仅保留结果为 `url` 的项**(模型可能输出非法或伪协议地址,这里必须过滤,不能直接信任)。
3. 导出 `stripWebPageMarkers(text: string): string`,清洗规则与 `stripArtifactMarkers` 一致(连带行尾空与换行)。
4. 注释说明为何要对 url 做白名单校验。

**验证:** `npx tsc --noEmit` 通过;用临时脚本验证 `【网页:Mastra 官网#https://mastra.ai】` 能解析出一项,`【网页:恶意#javascript:alert(1)】` 被过滤掉(0 项),并把输出贴进报告。

---

## T3: 桌面壳开启 webview 并加固

**文件:** `app-desktop/main.js`(修改)
**依赖:** 无

**步骤:**
1. 主窗口 `webPreferences`(约 115 行)增加 `webviewTag: true`,加中文注释说明用途是内置浏览器。
2. 在 `app.whenReady()` 内(`createWindow()` 调用之前)注册 `app.on('web-contents-created', (event, contents) => {...})`:
   - 判断 `contents.getType() === 'webview'` 才施加下列约束(不要影响主窗口)。
   - `contents.setWindowOpenHandler(() => ({ action: 'deny' }))`:页面内 `target=_blank` 新窗口请求不弹系统窗口。
   - 监听 `contents.on('will-navigate', (e, url) => {...})`:用 `new URL(url).protocol` 判断,非 `http:` / `https:` 调用 `e.preventDefault()`;解析异常也阻止。
   - 监听 `contents.on('will-attach-webview', ...)` 不需要;但要注释说明主窗口设了 `webSecurity: false`(为放行 file:// → localhost 的 API 请求),**webview 必须靠自身 `webpreferences` 属性恢复隔离**,该设置不会自动继承给 webview。
3. 注释说明这是 N2 的第二道防线(第一道在渲染层的地址栏校验)。

**验证:** `node -c app-desktop/main.js`(或 `node --check`)语法通过;在完成报告里列出你新增的事件监听与约束项。

---

## T4: 浏览器视图组件

**文件:** `app/src/components/BrowserPreview.tsx`(新建)
**依赖:** T1、T3

**步骤:**
1. 组件签名:`BrowserPreview({ url, active, onTitleChange }: { url: string; active: boolean; onTitleChange: (title: string) => void })`。
2. 内部 state:`address`(地址栏受控文本,初值 `url`)、`loading`、`canGoBack`、`canGoForward`、`error`(`{ code: number; description: string } | null`)。用 `useRef` 持有 webview DOM 元素。
3. **非桌面端提示**(F4,已按用户决定缩减为最小实现):`isDesktop()`(from `../lib/desktop`)为假时不渲染 webview,只显示一句「内置浏览器需在桌面端使用」+ 当前网址。**不要**做「在系统浏览器中打开」按钮 —— 本能力只做桌面端,不为浏览器环境做适配。这条存在的唯一目的是:开发时若直接用 Chrome 打开 Vite 地址,不出现无法解释的空白块。
4. 渲染 webview:JSX 里用 `<webview>` 需要给 TS 声明类型 —— 在文件顶部用 `declare global { namespace JSX { interface IntrinsicElements { webview: ... } } }` 或以 `as any` 局部绕过;选一种能通过 `tsc` 的写法并注释说明。属性:
   - `src={url}`
   - `webpreferences="nodeIntegration=no,contextIsolation=yes,webSecurity=yes"`(逗号分隔字符串,已核实为 Electron 33 的格式)
   - **不要**设置 `preload`、`nodeintegration`、`allowpopups`
   - `className="browser-webview"`
5. 事件订阅(在 `useEffect` 中用 `addEventListener`,清理时移除):
   - `did-start-loading` → `setLoading(true)`、清空 error
   - `did-stop-loading` → `setLoading(false)`,并用 `el.canGoBack()` / `el.canGoForward()` 刷新导航可用性
   - `page-title-updated` → `onTitleChange(e.title)`
   - `did-navigate` / `did-navigate-in-page` → 用事件里的 url 同步 `address`,刷新导航可用性
   - `did-fail-load` → 取回调的 `errorCode` 与 `errorDescription`;**`errorCode === -3` 是 ERR_ABORTED(用户主动取消/重定向打断),不视为错误、不显示错误页**(该判断请在实现时验证,若行为不符则改为按 `isMainFrame` 过滤);其余写入 `error` state
6. 地址栏:`<input>` 受控绑定 `address`,`onKeyDown` 回车时调 `resolveUrlInput(address)`:
   - `rejected` → 显示 reason(可用一个短暂提示条),不导航
   - `url` / `search` → `el.loadURL(结果.url)`
7. 导航按钮:后退/前进(`goBack`/`goForward`,`canGoBack`/`canGoForward` 为假时 `disabled`)、加载中显示停止按钮(`stop()`)否则显示刷新(`reload()`)。图标用 16px 线性 SVG,风格对齐项目 `SidebarIcon`(fill none / stroke currentColor / strokeWidth 1.7)。
8. 错误态(F8):`error` 非空时在渲染区上层显示错误码、描述与「重试」按钮(重试调 `el.reload()`)。
9. 「交给 agent」动作(F5):工具栏一个按钮,点击后:
   - `el.executeJavaScript("({ title: document.title, text: document.body?.innerText ?? '' })")`
   - 取到后把 text 截断到 8000 字符(截断时在末尾追加「…(内容已截断)」)
   - 派发 `window.dispatchEvent(new CustomEvent('h0-fill-composer', { detail: { title, url: 当前地址, text } }))`
   - 取值失败(catch)时仅派发 title 与 url,text 为空字符串,并在界面上给一个失败提示
10. `active` 为假时,最外层容器加 `display: none`(常驻挂载但隐藏,保住导航历史)。

**验证:** `npx tsc --noEmit` 通过;`npm run build` 通过。在报告里说明你用哪种方式让 `<webview>` 通过 TS 检查、以及 `-3` 错误码的处理方式。

---

## T5: 预览面板接入 browser 标签

**文件:** `app/src/components/PreviewPanel.tsx`(修改)
**依赖:** T4

**步骤:**
1. `PreviewPayload` 联合类型追加 `| { kind: 'browser'; url: string; title?: string }`;`PreviewTab['kind']` 追加 `'browser'`。
2. `samePayload` 增加 browser 分支:两者 kind 同为 browser 时按 `url` 相等判断(用于去重)。
3. `TabIcon` 增加浏览器分支:当传入标记为浏览器时用地球/罗盘图标(颜色 `#3b82f6`)。由于现有 `TabIcon` 按 `ext` 分派,可给它增加一个可选参数(如 `kind`)或另写一个小组件,选一种不破坏现有调用的写法。
4. **改为常驻挂载**(关键改动,plan 的技术决策):
   - 当前 `PreviewPanel` 只渲染 `activeTab` 的内容。改为:遍历 `tabs`,对 `kind === 'browser'` 的标签**全部渲染** `PreviewContent`(传 `active={tab.id === activeTabId}`),非 browser 标签仍只在激活时渲染。
   - `PreviewContent` 增加 `active?: boolean` 参数并透传给 `BrowserPreview`;非 browser 分支忽略该参数。
   - 容器层用 `style={{ display: active ? undefined : 'none' }}` 控制显隐,**不要用条件渲染**(条件渲染会卸载 webview,导航历史丢失)。
5. `PreviewContent` 增加 browser 分支:渲染 `<BrowserPreview url={payload.url} active={active} onTitleChange={...} />`;标题回填通过新增的 `onTitleChange` 回调上抛给 `PreviewPanel`,由它更新对应标签的 `title`(参照现有 `updateTabZoom` 的写法)。
6. browser 标签**不参与** `rememberRecentTab`(最近文件列表是文件用的);若要记录浏览历史属于 spec 明确不做的事,跳过。

**验证:** `npx tsc --noEmit`、`npm run build` 通过;在报告里说明你如何保证切换标签时 webview 不被卸载。

---

## T6: 新标签页地址栏

**文件:** `app/src/components/PreviewPanel.tsx`(修改 `NewTabPreview`)
**依赖:** T1、T5

**步骤:**
1. `NewTabPreview` 顶部已有(或即将有)一个输入框。把它的 placeholder 改为「搜索或输入网址」。
2. 输入框保持**双重用途**(F3):
   - 输入过程中(未回车):按输入内容过滤下方「最近文件」列表,大小写不敏感的 `includes` 匹配;有输入且无匹配时显示「没有匹配的文件」。
   - 回车时:调 `resolveUrlInput(输入)`;`rejected` 则在输入框下方显示 reason;否则调用 `onOpenTab('browser', 输入原文, { kind: 'browser', url: 结果.url })`。
3. 若 `NewTabPreview` 当前的 props 不含 `onOpenTab` 的 browser 能力,按需扩展其类型签名。

**验证:** `npx tsc --noEmit`、`npm run build` 通过。

---

## T7: 对话页接入(自动开页 + 输入框联动入口)

**文件:** `app/src/routes/TaskPage.tsx`(修改)
**依赖:** T2、T5

**步骤:**
1. 新增 `openBrowserTab(url: string, title: string, options?: { reveal?: boolean })`,**完全对齐现有 `openArtifactTab` 的结构**:
   - 先在 `previewTabsRef.current` 里找 `kind === 'browser'` 且 `payload.url === url` 的已有标签,存在则按 `reveal` 决定是否激活+展开面板+写 `h0-preview-open-v2`。
   - 不存在则 push 新标签(id 生成方式对齐现有写法),`reveal` 为真时激活并展开面板。
   - `reveal` 缺省为 `true`;为 `false` 时不展开面板、不写 localStorage、且仅在当前无激活标签时才设为激活(与 `openArtifactTab` 的既有逻辑一致)。
2. 监听 `h0-open-webpage` 事件(卡片点击入口),`detail` 含 `{ title, url }` 时调 `openBrowserTab(url, title)`。
3. **流式结束扫描**:现有那段「isRunning 由 true 转 false 后解析最后一条 assistant 文本」的逻辑里,除 `parseArtifacts` 外增加 `parseWebPages`,对每项调 `openBrowserTab(url, title)`(默认 reveal)。
4. **挂载时历史扫描**:现有那段扫描历史消息的 `useEffect` 里,同样增加 `parseWebPages`,但传 `{ reveal: false }`(与产物一致 —— 打开旧会话不应自动弹出面板)。

**验证:** `npx tsc --noEmit`、`npm run build` 通过;在报告里确认历史扫描路径上没有出现 `setPreviewOpen(true)` 或 localStorage 写入。

---

## T8: 消息内网页卡片

**文件:** `app/src/components/AssistantSteps.tsx`(修改)
**依赖:** T2

**步骤:**
1. 该文件的 `AssistantText` 已用 `parseArtifacts` + `stripArtifactMarkers` 处理产物标记。按同样模式接入网页标记:
   - 文本先经 `stripArtifactMarkers` 再经 `stripWebPageMarkers`,清洗后交给 `MarkdownText`。
   - `parseWebPages(text)` 的结果渲染为网页卡片,放在产物卡片之后。
2. 网页卡片结构与 `artifact-card` 同构(className 用 `webpage-card`),内含:蓝色地球图标 + 页面标题 + 网址(单行截断)。点击派发 `new CustomEvent('h0-open-webpage', { detail: { title, url } })`。
3. 卡片用 `<button type="button">` 而非 `<a>`(不要真的跳转外部浏览器)。

**验证:** `npx tsc --noEmit`、`npm run build` 通过。

---

## T9: 页面内容填入输入框

**文件:** `app/src/components/ChatThread.tsx`(修改)
**依赖:** T4

**步骤:**
1. 在 `ChatThread` 内新增 `useEffect`,监听 `h0-fill-composer` 事件,清理时移除监听。
2. 收到事件后拼装文本(格式建议:`以下是我正在浏览的网页,请帮我分析:\n标题:{title}\n网址:{url}\n\n{text}`),调用 `composer.setText(现有文本 ? 现有文本 + '\n\n' + 新文本 : 新文本)`。
3. **不要调用 `composer.send()`**(spec F5 明确要求不自动发送)。
4. 尽量把焦点移到输入框(可用 ref 或 `document.querySelector('.chat-composer-input')?.focus()`,选一种与现有代码风格一致的写法)。

**验证:** `npx tsc --noEmit`、`npm run build` 通过;在报告里确认没有调用 `send()`。

---

## T10: agent 网页引用规范

**文件:** `src/mastra/agents/agent.ts`(修改)
**依赖:** 无

**步骤:**
1. 找到 instructions 里既有的「产物输出规范」段落(约 96 行,内容为 `【产物:文件名#相对路径】` 的说明)。
2. 紧随其后增加「网页引用规范」:当需要用户查看某个网页时(如搜索到的来源、要展示的页面),在该轮回复末尾另起一行输出 `【网页:页面标题#完整网址】`,多个则输出多行;网址必须是完整的 http/https 地址;正文中不再粘贴裸链接,改用一句自然语言说明(例如「相关页面已在右侧打开」)。
3. 不要改动其它 instructions 内容。

**验证:** 项目根 `npx tsc --noEmit` 通过;在报告里贴出你新增的那段 instructions 原文。

---

## T11: 样式

**文件:** `app/src/styles/app.css`(修改)
**依赖:** T4、T5、T8

**步骤:**
1. 新增样式类:
   - `.browser-view`(最外层 flex column,撑满内容区)
   - `.browser-toolbar`(地址栏行:flex、gap 6px、padding 8px 10px、底部 1px 分隔线 `var(--ui-border-card)`)
   - `.browser-nav-btn`(28px 方形圆角按钮,`disabled` 时降透明度)
   - `.browser-address`(输入框:flex 1、border 1px `var(--ui-border-card)`、border-radius 999px、padding 6px 12px、字号 13px、去掉 outline)
   - `.browser-webview`(flex 1、width 100%、border none、背景白)
   - `.browser-error` / `.browser-fallback`(居中提示块,含说明文字与按钮)
   - `.browser-hint`(地址栏下方的拒绝提示,红色小字)
   - `.webpage-card`(与既有 `.artifact-card` 同构:flex、gap 10px、padding、圆角、hover 阴影;图标区蓝色系)
2. 字重统一用 600(**本项目字体栈下 500 对中文无效会回落 400**,这一点已在 app.css 末尾的注释里说明过)。
3. 颜色统一用既有令牌(`--ui-text-primary` / `--ui-text-tertiary` / `--ui-border-card` / `--ui-radius-md`),不要硬编码新的灰阶。

**验证:** `npm run build` 通过;在报告里列出新增的类名清单。

---

## 执行顺序

```
T1(urlInput) ─┬─→ T2(网页标记) ─┬─→ T7(TaskPage 自动开页)
              │                  └─→ T8(消息卡片)
              └─→ T4(BrowserPreview) ─┬─→ T5(面板接入) ─→ T6(新标签页地址栏)
                                       └─→ T9(填入输入框)
T3(main.js)  ← 可与 T1/T2 并行,无依赖
T10(agent)   ← 可独立执行,无依赖
T11(样式)    ← 需 T4/T5/T8 的 className 定稿后
```

**与其它任务的文件冲突提示:** 另有一个正在进行的任务在改 `PreviewPanel.tsx` 与 `app.css`(新标签页视觉重做:单列胶囊、文件图标、标签栏布局)。T5/T6/T11 必须等该任务完成后再执行,否则两边会互相覆盖。T1/T2/T3/T10 无冲突,可先做。
