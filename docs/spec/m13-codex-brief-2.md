# M13 Codex 指令书 · 批 2（前端:产物长卡 + 内联预览 + 三点菜单）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序执行，不做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；禁止运行 dev server / vite；禁止调用任何本地/远程服务
3. 禁止用 PowerShell `Set-Content` 写含中文的文件
4. 每个任务完成后跑：`cd app && npx tsc --noEmit`（必须通过才进入下一任务）

## 背景

M13 批 1（后端）已完成并验证可用：

- `GET /workspace/files/stat?path=<workspace相对路径>` → `{ size, absolutePath }`（404 文件不存在 / 400 越界）
- `POST /workspace/files/open` `{path}` → `{ok:true}`（系统默认程序打开，秒回）
- `POST /workspace/files/reveal` `{path}` → `{ok:true}`（资源管理器定位选中）
- `GET /workspace/files/openwith?path=` → `{ apps: [{ id, name, iconDataUrl?, isDefault }], degraded? }`（服务端按扩展名缓存）
- `POST /workspace/files/open-with` `{path, appId}` → `{ok:true}`（appId 来自 openwith 结果；伪造 id → 400「应用不可用，请重新打开菜单」）

前端现状：产物卡渲染在 `app/src/components/AssistantSteps.tsx` 的 `AssistantText` 组件内（搜索 `artifact-card`），点击派发 `window.dispatchEvent(new CustomEvent('h0-open-artifact', { detail: artifact }))`（TaskPage 监听后打开预览标签）；网页引用的紧凑胶囊 `SourceBadge` 也在该文件，**不要动它**。

本批新建 `ArtifactCard` 组件（长卡 + 类型图标 + 大小 + 内联预览 + 三点菜单），下一批才替换 AssistantSteps 里的旧卡。API 基地址常量在 `app/src/lib/apiBase.ts`（`API_BASE`）。

## T4+T5b: 新建 `app/src/components/ArtifactCard.tsx`

**步骤：**

1. `FileIcon({ ext }: { ext: string })`：内联 SVG 或色块+字符组合，36px 圆角块。映射（小写匹配）：
   - `pdf` 红底 `#e53e3e` 白字 "PDF"；`docx/doc` 蓝底 `#2b579a` 白字 "W"；`xlsx/xls/csv` 绿底 `#217346` 白字 "X"；`pptx/ppt` 橙底 `#d24726` 白字 "P"
   - `png/jpg/jpeg/webp/gif/svg` 紫底 `#805ad5` 白字 "图"；`html/htm` 橙红底 `#e34c26` 白字 "</>"
   - `txt/md/json/py/js/ts/sh` 灰底 `#6b7280` 白字 "T"；未知 → 灰底通用文档形
   - 白字加粗 11px、居中；用 `<span>` 而非图片
2. `useArtifactSize(path)`: 挂载后 `fetch(\`${API_BASE}/workspace/files/stat?path=${encodeURIComponent(path)}\`)` → 成功返回 size，任何失败返回 null；`formatSize` 从 `../lib/driveClient` 导入（已存在）
3. `ArtifactMenu({ artifact, onClose })`：三点按钮 + 浮层（相对定位，按钮下方右对齐，class `artifact-menu`）。五个菜单项行为：
   - **打开**：`POST /workspace/files/open` body JSON `{path: artifact.path}` → 失败在菜单底部显示错误行
   - **打开文件夹**：`POST /workspace/files/reveal` 同上
   - **另存为**：动态创建 `<a href="${API_BASE}/workspace/files/raw?path=${encodeURIComponent(artifact.path)}&download=1" download="${artifact.name}">` 触发 click（raw 端点已存在；若 download 参数报错就直连 raw URL）
   - **复制路径**：先 GET stat 拿 absolutePath → `navigator.clipboard.writeText` → 该菜单项文字 1.5 秒变「已复制」；失败显示错误
   - **打开方式**：hover 或点击展开二级浮层（右侧，class `artifact-submenu`）：懒加载 `GET openwith?path=`，loading 态「正在获取应用…」；行渲染 = 图标（`iconDataUrl` 有则 `<img src>` 16px，无则通用 SVG）+ name + isDefault 加「默认」徽标；点击行 → `POST open-with` {path, appId} → 关闭菜单；空列表或 degraded → 显示「没有可用的应用」
   - 所有请求失败：菜单底部一行红字 `artifact-menu-error` 显示「打开失败/另存失败」等短文案 + 原因，5 秒自动消失
4. **InlinePreview({ artifact, ext })**：
   - `ext === 'pptx'`：挂载后 fetch raw 端点（ArrayBuffer）→ `import { init } from 'pptx-preview'` 渲染到容器（参数参考 `PreviewPanel.tsx` 内 pptx 渲染实现——先读该文件相关段落再写；宽度取容器宽）；容器 class `artifact-inline artifact-inline-pptx`
   - `ext === 'html' || ext === 'htm'`：`<iframe src="${raw端点}" sandbox="allow-scripts" class="artifact-inline artifact-inline-html">`，**必须**带 `sandbox="allow-scripts"` 且**不得**加 allow-same-origin（注释写明：隔离宿主页面与会话数据）；固定高度 320px
   - 其余 ext 返回 null
   - 任何渲染/加载失败 → 显示 `artifact-inline-fail`「预览加载失败，点击卡片在预览栏打开」；点击该提示与预览区（iframe 上加透明捕获层）都 dispatch `h0-open-artifact`
5. `ArtifactCard({ artifact }: { artifact: Artifact })`（Artifact 类型从 `../lib/artifacts` 导入）：
   - 根 `div.artifact-long-card`：左 FileIcon(ext) + 中列（文件名 `artifact-name`；副标题 `artifact-sub`：扩展名大写 + formatSize 大小，大小加载中显示「…」，失败只显类型）+ 右侧三点按钮
   - 三点按钮 `aria-label="文件操作菜单"`，点击 stopPropagation 切换菜单
   - 主体点击 dispatch `h0-open-artifact`（detail 用 artifact 原对象）——即与现有卡片行为一致
   - pptx/html 在卡头下渲染 InlinePreview
6. 全部外部文本纯文本节点渲染；禁止 `dangerouslySetInnerHTML`

**验证：** `cd app && npx tsc --noEmit` 通过

## T5: 菜单键盘导航与浮层关闭细节

**文件：** 同上（T4 基础上完善）
**步骤：**
1. 菜单打开时：document `mousedown` 点击外部关闭、`keydown` Escape 关闭（先关子菜单再关主菜单）
2. 键盘：菜单项 `tabIndex` 可聚焦，↑↓ 在项间移动（滚动容器内滚动跟随），Enter 执行，← 收起子菜单
3. 三点按钮 aria-haspopup="menu"、aria-expanded 同步

**验证：** `cd app && npx tsc --noEmit` 通过

## 汇报格式

完成后回复：新建文件、每步 tsc 结果、T4 中 InlinePreview 各分支的渲染参数摘要（对比 PreviewPanel 的 pptx 渲染差异说明）、遗留问题。
