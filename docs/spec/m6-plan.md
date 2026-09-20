# M6 内置浏览器 Plan

> 前置:[m6-spec.md](./m6-spec.md) 已确认
> 技术栈:React 19 + TypeScript + Vite(前端)、Electron 33.4.11(桌面壳)、Mastra(后端)

## 架构概览

浏览能力作为**预览面板的一种新标签类型**接入,不新建页面、不新建路由。五个部分:

1. **桌面壳能力开启**:Electron 主窗口启用 `webview` 标签支持,并对内嵌页面施加导航与新窗口约束。
2. **浏览器视图组件**:一个独立组件封装 `webview` 元素、地址栏、导航控件、加载/错误状态。
3. **地址输入解析**:一个纯函数模块判定「网址 or 关键词」、补全协议、拦截非白名单协议。
4. **标签体系接入**:预览面板的标签类型增加 `browser`,并改为「浏览器标签常驻挂载、非激活时隐藏」以保住导航历史。
5. **双向联动**:页面内容 → 对话输入框(F5)、agent 标记 → 自动开页(F6),两者都走既有的 `h0-*` 自定义事件模式。

## 核心数据结构

### PreviewPayload 扩展(app/src/components/PreviewPanel.tsx)

现有联合类型追加一个分支:

```ts
| { kind: 'browser'; url: string; title?: string }
```

`PreviewTab['kind']` 相应追加 `'browser'`。`url` 为已规范化的完整地址(含协议),`title` 由页面标题事件回填。

### 地址输入解析结果(app/src/lib/urlInput.ts)

```ts
type UrlResolution =
  | { kind: 'url'; url: string }        // 可直接访问
  | { kind: 'search'; url: string }     // 关键词,已拼成搜索引擎地址
  | { kind: 'rejected'; reason: string } // 协议不在白名单
```

```ts
resolveUrlInput(raw: string): UrlResolution
```

判定顺序:去首尾空白 → 若含 `://` 则校验协议是否为 `http`/`https`(否则 `rejected`) → 若无协议但匹配「含点且无空格」的域名形态则补 `https://` → 其余作为关键词拼搜索地址。

### 网页标记(app/src/lib/artifacts.ts 扩展)

与既有产物标记同一风格,新增:

```ts
type WebPage = { title: string; url: string };
parseWebPages(text: string): WebPage[]
stripWebPageMarkers(text: string): string
```

标记形态 `【网页:标题#网址】`。解析时对 `url` 施加与地址栏相同的协议白名单校验,不合规的标记丢弃(视作模型输出异常)。

### 浏览器视图内部状态(app/src/components/BrowserPreview.tsx)

```ts
{
  address: string;      // 地址栏当前文本(受控输入,与实际 url 解耦)
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: { code: number; description: string; url: string } | null;
}
```

## 模块设计

### 模块 A:桌面壳(app-desktop/main.js)

**职责**:开启 `webview` 支持,并在主进程侧兜住安全约束。
**改动**:
- 主窗口 `webPreferences` 增加 `webviewTag: true`。
- 监听 `web-contents-created`:对 `type === 'webview'` 的 webContents,设置 `setWindowOpenHandler` 返回 `{ action: 'deny' }`(N3 由渲染层改为在产品内开标签),并拦截 `will-navigate`,非 `http`/`https` 一律阻止(N2 的第二道防线)。
**注意**:主窗口设了 `webSecurity: false`(为放行 `file://` → `localhost` 的 API 请求)。webview 必须通过自身属性恢复隔离,不能继承该设置。

**依赖**:无。

### 模块 B:地址输入解析(app/src/lib/urlInput.ts)

**职责**:纯函数,输入用户文本输出可访问地址或拒绝理由。
**对外接口**:`resolveUrlInput`、`SEARCH_ENGINE_TEMPLATE`(可配置的搜索地址模板)。
**依赖**:无(便于单独验证)。

### 模块 C:浏览器视图(app/src/components/BrowserPreview.tsx)

**职责**:渲染地址栏 + 导航控件 + `webview`,管理加载与错误状态,提供「交给 agent」动作。
**对外接口**:
```ts
BrowserPreview(props: {
  url: string;
  active: boolean;                          // 非激活时容器隐藏但保持挂载
  onTitleChange: (title: string) => void;   // 回填标签标题
})
```
**内部要点**:
- 非桌面端(`isDesktop()` 为假)不渲染 `webview`,只显示一句「内置浏览器需在桌面端使用」的提示(F4,已按用户决定缩减:不做系统浏览器兜底)。
- `webview` 属性:禁用 node 集成、开启 contextIsolation、开启 webSecurity、不挂 preload(N1)。
- 订阅事件:`did-start-loading` / `did-stop-loading`(loading)、`page-title-updated`(标题)、`did-fail-load`(错误)、`did-navigate` 与 `did-navigate-in-page`(刷新前进后退可用性)。
- 导航动作调用 `webview` 实例方法:`goBack` / `goForward` / `reload` / `stop` / `loadURL`。
- 「交给 agent」:通过 `executeJavaScript` 取 `document.title` 与正文文本,截断后派发 `h0-fill-composer` 事件;取值失败则只带标题与网址(F5)。

**依赖**:模块 B(地址解析)、`lib/desktop.ts`(环境判定)。

### 模块 D:预览面板接入(app/src/components/PreviewPanel.tsx)

**职责**:把 `browser` 标签纳入现有标签体系。
**改动**:
- `PreviewPayload` / `PreviewTab['kind']` 增加 browser 分支;`TabIcon` 增加浏览器图标分支(与文件类图标区分)。
- **渲染方式改为常驻挂载**:现在只渲染 `activeTab` 一个内容;改为所有 `browser` 标签都挂载,用容器 `display` 控制显隐,非 browser 标签仍按原方式只渲染激活项。理由见「技术决策」。
- 新标签页(`NewTabPreview`)首项输入框:未提交时过滤最近文件(既有行为),回车时调用 `resolveUrlInput` 并把当前标签转为 browser 标签(F3)。
- 页面标题回填:`onTitleChange` 更新对应标签的 `title`。

**依赖**:模块 B、模块 C。

### 模块 E:对话侧联动

**E1 页面内容 → 输入框(app/src/components/ChatThread.tsx)**
监听 `h0-fill-composer` 事件,收到后 `composer.setText(现有文本 + 页面文本)` 并聚焦输入框,**不调用 `send`**(F5 明确要求不自动发送)。

**E2 agent 标记 → 自动开页**
- `app/src/components/AssistantSteps.tsx`:`AssistantText` 中先 `stripWebPageMarkers` 清洗文本,再为每个 `parseWebPages` 结果渲染网页卡片(样式与产物卡片同构,图标改为地球/链接),点击派发 `h0-open-webpage`。
- `app/src/routes/TaskPage.tsx`:新增 `openBrowserTab(url, title, options?: { reveal?: boolean })`,逻辑对齐既有 `openArtifactTab`(同 url 只激活不重建、`reveal` 控制是否展开面板与写 localStorage)。挂载时扫描历史消息传 `reveal: false`,流式结束扫描与卡片点击用默认 `reveal: true`。
- `src/mastra/agents/agent.ts`:instructions 的「产物输出规范」旁增加「网页引用规范」——需要用户查看某个网页时,在回复末尾另起一行输出 `【网页:标题#网址】`,一次多个则多行;正文中不再粘贴裸链接。

**依赖**:模块 D。

## 模块交互

**用户主动浏览**
```
新标签页输入框 回车
  → resolveUrlInput(文本)
  → rejected? 显示提示,停止
  → 否则:把当前标签 payload 换成 { kind:'browser', url }
  → PreviewPanel 渲染 BrowserPreview
  → webview loadURL → page-title-updated → onTitleChange → 标签标题更新
```

**agent 主动开页(F6)**
```
agent 回复含【网页:标题#网址】
  → 流式结束 → TaskPage 扫描最后一条 assistant 文本
  → parseWebPages → openBrowserTab(url, title)  [reveal: true]
  → 面板展开 + 新建/激活 browser 标签
同时 AssistantText 把标记清洗掉,渲染成网页卡片(点击 → h0-open-webpage → 同一入口)
```

**页面内容交给 agent(F5)**
```
BrowserPreview 工具栏动作
  → webview.executeJavaScript 取标题与正文
  → 派发 h0-fill-composer { title, url, text }
  → ChatThread 监听 → composer.setText(拼好的文本) + 聚焦
  → 用户补充问题后手动发送
```

## 文件组织

```
app-desktop/
└── main.js                          → 开启 webviewTag;web-contents-created 施加导航/新窗口约束

app/src/
├── lib/
│   ├── urlInput.ts                  → 新建:resolveUrlInput、协议白名单、搜索模板
│   └── artifacts.ts                 → 扩展:parseWebPages、stripWebPageMarkers
├── components/
│   ├── BrowserPreview.tsx           → 新建:地址栏 + 导航控件 + webview + 降级提示
│   ├── PreviewPanel.tsx             → 扩展:browser 标签类型、常驻挂载、TabIcon、新标签页输入框
│   ├── AssistantSteps.tsx           → 扩展:网页卡片渲染 + 标记清洗
│   └── ChatThread.tsx               → 扩展:监听 h0-fill-composer
├── routes/
│   └── TaskPage.tsx                 → 扩展:openBrowserTab、事件监听、历史/流式扫描
└── styles/
    └── app.css                      → 新增:地址栏、导航按钮、webview 容器、降级提示、网页卡片

src/mastra/agents/
└── agent.ts                         → instructions 增加「网页引用规范」
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 网页渲染方式 | Electron `webview` 标签 | `iframe` 被多数站点的 `X-Frame-Options` / CSP 拒绝,无法用于通用浏览;`webview` 是 Electron 内唯一可渲染任意站点的方案 |
| 网页版行为 | 显式降级提示 + 系统浏览器兜底 | 技术上无法在浏览器内渲染任意网页,给假控件会让用户以为坏了(F4) |
| 标签内容挂载 | browser 标签常驻挂载,非激活时隐藏 | 现有实现只渲染激活标签,切走会卸载 `webview` → 页面重新加载、前进后退历史清空。常驻挂载是保住导航状态的必要条件 |
| 非 browser 标签 | 仍只渲染激活项 | 文件/文档预览重建成本低,常驻挂载反而增加内存与请求;只对有状态的 browser 破例 |
| 地址栏与 url 分离 | 地址栏文本是独立受控 state | 用户编辑地址栏时不应影响当前页面;仅回车时才导航 |
| 协议校验位置 | 渲染层 + 主进程双层 | 渲染层给用户即时提示,主进程 `will-navigate` 兜住页面内跳转(用户点击链接不经过地址栏) |
| 网页标记形态 | `【网页:标题#网址】` | 与既有 `【产物:名称#路径】` 同构,前端解析、清洗、卡片渲染都能沿用同一套模式,模型也更容易遵循 |
| 页面文本提交方式 | 填入输入框不自动发送 | spec F5 要求;用户通常需要补充「帮我总结」之类的指令 |
| 跨组件通信 | 自定义事件 `h0-fill-composer` / `h0-open-webpage` | 项目已有 `h0-open-artifact` 等 8 个同类事件,沿用可避免为一次性联动改造组件树 |
| 正文提取上限 | 截断到固定长度(建议 8000 字符) | 整页文本可能极长,直接塞进输入框会挤爆上下文;截断并标注「已截断」 |

## 待实现时验证的技术细节

以下三点依赖 Electron 33 的具体 API 形态,实现前需对照 `app-desktop/node_modules/electron` 的类型定义或官方文档确认,不可凭记忆:

1. `webview` 标签禁用 node 集成、开启 contextIsolation/webSecurity 的**属性写法**(`webpreferences` 字符串格式在各版本有差异)。
2. webview 内页面触发新窗口时,Electron 33 的**推荐拦截方式**(旧版 `new-window` 事件已废弃,现应通过主进程 `setWindowOpenHandler`)。
3. `did-fail-load` 的**错误码含义**,用于区分「用户取消」(不应显示错误页)与真实失败。
