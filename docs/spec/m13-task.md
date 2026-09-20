# M13 产物文件卡与系统操作菜单 Tasks

> 前置：M12 全部任务验收完成后才开始本清单（codex 单实例纪律）。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/mastra/server/workspace-routes.ts` | stat/open/reveal/openwith/open-with 端点 |
| 新建 | `src/mastra/server/openwith-probe.ps1` | 注册表枚举 + 图标提取脚本 |
| 新建 | `app/src/components/ArtifactCard.tsx` | 长卡 + FileIcon + ArtifactMenu |
| 修改 | `app/src/components/AssistantSteps.tsx` | 替换两处内联产物按钮 |
| 修改 | `app/src/styles/app.css` | 长卡与菜单样式 |

## 执行者约定

- **[codex]** T1-T6，严格串行；**[主]** T7 验收与全部运行时验证复核
- codex 指令书附安全红线（同 M12）：只改清单文件、不联网、不跑 dev server、中文文件禁 `Set-Content`（含 .ps1 —— PowerShell 脚本必须 UTF-8 with BOM 或纯 ASCII，用 Node 写入）
- 编译验证：根 `npx tsc --noEmit`；前端 `cd app && npm run build`

## T1: stat / open / reveal 端点 [codex]

**文件：** `src/mastra/server/workspace-routes.ts`
**依赖：** 无
**步骤：**
1. `GET /workspace/files/stat?path=`：过既有边界校验 → `fs.stat` → `{size, absolutePath}`；不存在 → 404 `{error: '文件不存在'}`；越界 → 400（文案与现有端点一致）
2. `POST /workspace/files/open`（body `{path}`）：校验 → `exec(`start "" "${abs}"`)`（shell:true，abs 已过校验；对引号做转义处理）→ `{ok:true}`；执行失败 → 500 带原因
3. `POST /workspace/files/reveal`（body `{path}`）：校验 → `exec(`explorer /select,"${abs}"`)` → `{ok:true}`（explorer 返回码 1 属正常，注明）
4. 三个端点风格（路由注册、错误结构）对齐文件内既有端点；头部注释写明 N2 边界要求

**验证（主复核）：** tsc 过；dev server 起后对真实产物三连测：stat 返回正确 size 与绝对路径、open 用默认程序打开、reveal 打开文件夹选中

## T2: openwith 枚举脚本与端点 [codex]

**文件：** `src/mastra/server/openwith-probe.ps1`（新建）、`workspace-routes.ts`
**依赖：** T1（同文件）
**步骤：**
1. 新建 `openwith-probe.ps1`：入参 `-Ext "pdf"`；逻辑：
   - 读 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\<ext>\UserChoice`（默认 ProgID）与 `OpenWithList`，再读 `HKCR:\<ext>\OpenWithProgids` 合并去重
   - 对每个 ProgID：`HKCR:\<progid>\Shell\Open\Command` 取命令行（`"%1"` 占位替换为实际文件路径后即启动命令；UWP/无 command 的 ProgID 尝试 `shell:AppsFolder` + AUMID，取不到名称则跳过）；FriendlyTypeName（含 `@dll,-res` 间接字符串用 `SHLoadIndirectString` 或 `[System.Text.RegularExpressions]` 兜底——优先用 .NET `Microsoft.Win32` API 组合）
   - 图标：`[System.Drawing.Icon]::ExtractAssociatedIcon($exePath)` → 转 PNG base64（32px）；失败留空
   - 输出单个 JSON 数组：`[{name, command, isDefault, iconBase64}]`；任何单条失败不影响整体（try/catch 包每条）
2. `workspace-routes.ts` 新增 `GET /workspace/files/openwith?path=`：
   - 校验路径 → 取扩展名（无扩展名 → 空数组）
   - spawn `powershell -NoProfile -ExecutionPolicy Bypass -File openwith-probe.ps1 -Ext <ext>`，10s 超时，超时/崩溃 → 返回 `{apps: [], degraded: true}`
   - 生成 `appId`（crypto.randomUUID），组装 `{apps: [{id, name, iconDataUrl, isDefault}]}`，commands 存模块级 `Map<ext, Map<appId, command>>`
   - 缓存命中直接返回；`?refresh=1` 跳过
3. .ps1 文件写入用 Node `fs.writeFileSync`（UTF-8），禁止 Set-Content

**验证（主复核）：** tsc 过；PowerShell 脚本对 `.pdf`、`.docx`、`.txt`、自造扩展名 `.xyz13` 各跑一次，检查 JSON 结构与默认标记；端点返回结构正确、第二次调用明显变快

## T3: open-with 端点 [codex]

**文件：** `src/mastra/server/workspace-routes.ts`
**依赖：** T2
**步骤：**
1. `POST /workspace/files/open-with`（body `{path, appId}`）：路径校验 → 按扩展名查 commands 缓存 → 命中则 `exec(start "" "<file>" …)` 或对 UWP 命令直接 exec → `{ok:true}`；未命中 → 400 `{error: '应用不可用，请重新打开菜单'}`
2. command 内的 `"%1"` 占位在服务端替换为校验后的绝对路径（转义后拼接）；注释写明：此映射只存服务端，前端仅持 opaque id（N2）

**验证（主复核）：** tsc 过；真实调用：用枚举结果中的非默认应用打开 pdf 成功；伪造 appId 返回 400

## T4: ArtifactCard 组件 [codex]

**文件：** `app/src/components/ArtifactCard.tsx`（新建）
**依赖：** T1（stat 端点可用）
**步骤：**
1. `FileIcon({ext})`：内联 SVG，按扩展名映射——pdf（红底白 PDF 字样）/docx（蓝底 W）/xlsx（绿底 X）/pptx（橙底 P）/txt/md/html/json（中性灰底文档形）/png/jpg/webp/gif（紫底山形）/py/js/ts/sh（深底代码形）/未知（灰底通用文件形）；尺寸 36px 圆角块
2. `useArtifactSize(path)`：挂载 fetch stat → `{size}` | null；格式化 `formatSize`（复用 `lib/driveClient` 现有函数）
3. `ArtifactCard({artifact})`：长卡布局（图标 + 名称 + `类型 · 大小` 副标题 + 三点按钮区）；类型标签 = 扩展名大写；点击主体 dispatch `h0-open-artifact`（detail 用 artifact 原对象）；三点按钮点击 `e.stopPropagation()` 只开菜单
4. 副标题大小加载中不占位抖动（min-width）；失败只显类型
5. 全部文本纯节点渲染

**验证（主复核）：** `cd app && npm run build` 过

## T5b: 内联预览 [codex]

**文件：** `app/src/components/ArtifactCard.tsx`（同文件追加）
**依赖：** T4
**步骤：**
1. `InlinePreview({artifact, ext})`：ext 为 `pptx` 时用 `pptx-preview` 的 `init`（参考 `PreviewPanel.tsx` 内现有 pptx 渲染实现的参数——宽度取卡片宽度、slide 纵向排列），容器类名 `artifact-inline artifact-inline-pptx`；ext 为 `html`/`htm` 时渲染 `<iframe src={raw端点} sandbox="allow-scripts" className="artifact-inline artifact-inline-html">`（**不得**加 allow-same-origin，注释写明隔离原因）；其余 ext 返回 null
2. 懒加载：pptx 渲染在组件挂载后 fetch raw 文件（ArrayBuffer）再 init；失败（fetch 非 200 / init 抛错）渲染 `.artifact-inline-fail`「预览加载失败，点击卡片在预览栏打开」；iframe 用 onError 兜底 + 固定高度 320px 内部滚动
3. 点击预览区（iframe 上层加透明捕获层）dispatch `h0-open-artifact` 进右侧预览栏
4. ArtifactCard 卡头下方按 ext 条件渲染 InlinePreview

**验证（主复核）：** `cd app && npx tsc --noEmit` 过；真实生成 pptx/html 产物后卡内直接可见预览

## T5: ArtifactMenu 菜单 [codex]

**文件：** `app/src/components/ArtifactCard.tsx`（同文件追加）
**依赖：** T2、T3、T4
**步骤：**
1. `ArtifactMenu({artifact})`：绝对定位浮层（三点按钮下方右对齐）；五项：打开/打开文件夹/另存为/复制路径/打开方式（右侧 `›`）
2. 打开 → POST open；打开文件夹 → POST reveal；另存为 → 创建隐藏 `<a href=raw&download=1 download=artifact.name>` 触发点击；复制路径 → GET stat → `navigator.clipboard.writeText` → 项文案 1.5s 变「已复制」；失败统一在菜单底部显示一行红字错误（fetch 失败/error 字段），可自动消失
3. 打开方式：hover 或点击展开二级浮层（右侧）；懒加载 openwith（loading 态「正在获取应用…」）；行 = 图标（iconDataUrl 有则 img，无则通用 SVG）+ 名称 + 默认徽标；点击 → POST open-with；空列表 → 「没有可用的应用」；degraded → 同空态
4. 关闭与键盘：document mousedown 点外关闭、Esc 关闭（子菜单先关）；↑↓ 移动焦点、Enter 执行、← 收起子菜单（N6）；三点按钮 aria-label「文件操作菜单」
5. 子菜单与菜单打开互不阻塞滚动（不用 modal）

**验证（主复核）：** build 过；真实菜单走查五项行为

## T6: 接入替换与样式 [codex]

**文件：** `app/src/components/AssistantSteps.tsx`、`app/src/styles/app.css`
**依赖：** T4、T5
**步骤：**
1. AssistantSteps：两处内联 `artifact-card` 按钮（otherArtifacts 区与 scriptArtifacts 折叠区）替换为 `<ArtifactCard artifact={a} />`；删除不再使用的 JSX 与 `openArtifact` 局部闭包（事件改由组件派发，保持事件名不变）
2. app.css：新增 `artifact-long-card` 系（flex 长卡、hover 态）、`artifact-menu`/`artifact-menu-item`/`artifact-submenu`（阴影圆角浮层，色板对齐 `.model-menu`）、`artifact-openwith-row`、默认徽标、焦点环；删除 `artifact-card` 系旧样式（确认无其它引用）
3. 中文注释

**验证（主复核）：** build 过；全局 grep `artifact-card` 无残留引用

## T7: 端到端验收 [主]

**文件：** 无（对照 `m13-checklist.md`，届时按本清单生成）
**依赖：** T1-T6
**步骤：**
1. dev server 起，逐条跑 checklist：生成 Word+PDF 双产物验样式、五菜单项逐个真实执行、打开方式双扩展名、越界路径拒绝、假 appId 400、删文件后失败提示、键盘全流程、缓存提速
2. 结果记入 `docs/spec/m13-验收报告.md`

**验证：** checklist 逐项有证据

## 执行顺序

```
T1 → T2 → T3 → T4 → T5b → T5 → T6 → T7
└────── codex 串行段 ──────────────┘   ↑ 主 agent
```
