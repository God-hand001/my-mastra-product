# M13 产物文件卡与系统操作菜单 Plan

## 架构概览

改动分两侧：

**后端（workspace-routes.ts 扩展一个路由组）**：产物操作端点。复用现有 `safeJoin` 式 workspace 边界校验，新增：stat（大小 + 绝对路径）、open（系统默认程序打开）、reveal（资源管理器定位）、openwith（枚举关联应用）、open-with（按枚举出的应用标识打开）。应用枚举通过一次 PowerShell 调用完成注册表查询 + 图标提取，输出 JSON；服务端按扩展名缓存枚举结果，并把「应用标识 → 启动命令」映射留在服务端内存中，前端永远只回传标识。

**前端（产物卡重构为独立组件）**：现在内联在 AssistantSteps 的 `artifact-card` 按钮抽成 `ArtifactCard`：图标（按扩展名的 SVG 组件）+ 名称 + `类型 · 大小`（大小懒加载）+ 三点菜单（浮层，含打开方式子菜单）。点击主体仍派发既有 `h0-open-artifact` 事件走站内预览。另存为直接用现有 raw 端点 + `<a download>`；复制路径用 stat 返回的绝对路径 + `navigator.clipboard`。

执行顺序约束：codex 单实例纪律，M13 开发排在 M12 全部任务验收之后；本文档先行审批。

## 核心数据结构

### 枚举出的应用（后端）

```ts
interface OpenWithApp {
  id: string;          // 服务端生成的标识（缓存键），前端回传它来选择应用
  name: string;        // 友好名称，如「WPS Office」「Google Chrome」
  iconDataUrl?: string; // data:image/png;base64,…；提取失败则无此字段
  isDefault: boolean;  // 该扩展名的 UserChoice 默认程序
}
```

服务端缓存：`Map<ext, { apps: OpenWithApp[]; commands: Map<appId, string> }>`（commands 不出服务端）。缓存无 TTL，进程生命周期内有效；提供 `?refresh=1` 参数跳过缓存（调试用，不进 UI）。

### stat 响应

```ts
{ size: number; absolutePath: string }  // absolutePath 仅用于复制路径功能
```

## 模块设计

### 后端：workspace-routes.ts（修改）

**职责：** 新增产物操作端点（见上）。
**关键实现：**
- 边界校验复用文件内既有 normalize/校验函数，每个端点独立执行（N2）
- open / reveal：`child_process.exec` 调 Windows `start "" "<abs>"` 与 `explorer /select,"<abs>"`（绝对路径已过边界校验且经 shell 转义处理）
- openwith：spawn PowerShell 执行内嵌脚本——读 `HKCU\...\FileExts\<ext>\OpenWithList`、`UserChoice`、`HKCR\<ext>\OpenWithProgids`，解析各 ProgID 的命令行与 FriendlyTypeName，`System.Drawing` 提取 exe 关联图标转 PNG base64，输出单个 JSON；UWP 应用（ProgID 指向 package）降级：取得到名称就列出，启动时走 `explorer.exe shell:AppsFolder\<AUMID>`，取不到则跳过
- open-with：按 appId 查缓存 commands，`Start-Process` 执行；appId 未命中缓存 → 400
- 文件不存在 → 404 带中文原因（F15）
**依赖：** 无新 npm 包（PowerShell 走 child_process）。

### 前端：ArtifactCard.tsx（新建）

**职责：** 长卡 + 图标 + 大小 + 三点菜单（F1-F11）+ 内联预览（F16-F18）。
**组成：**
- `FileIcon({ext})`：SVG 图标组件，按扩展名映射（pdf/docx/xlsx/pptx/图片/文本代码/通用），单色块 + 白色标识字母/图形，颜色近似各软件品牌（N5）
- `useArtifactSize(path)`：挂载后异步 fetch stat，失败返回 null（F3 降级只显类型）
- `ArtifactMenu({artifact})`：三点按钮 + 浮层菜单。菜单项：打开（POST open）、打开文件夹（POST reveal）、另存为（隐藏 `<a href=raw download>` 触发）、复制路径（clipboard.writeText(absolutePath)，成功后按钮文案短暂变「已复制」）、打开方式（子菜单：懒加载 openwith，行 = 图标 + 名称 + 「默认」标；空列表显示「没有可用的应用」）
- 浮层：固定定位 + 点击外部/Esc 关闭（document listener）；方向键/Enter/Escape 键盘导航（N6）
- 内联预览（F16-F18）：卡头下方按扩展名分流——pptx 用 `pptx-preview`（`init` API，从 PreviewPanel 现有实现复用渲染参数：宽度自适应卡片、按 slide 纵向排列）；html 用 `<iframe src={raw端点} sandbox="allow-scripts">`（不给 allow-same-origin，隔离宿主数据）。两者均懒渲染（IntersectionObserver 或挂载后异步）、失败显示 `.artifact-inline-fail` 提示。点击预览区 `dispatchEvent('h0-open-artifact')`
- 所有外部文本纯文本节点渲染（N3）
**对外接口：** `<ArtifactCard artifact={Artifact} />`；点击主体/预览区 `dispatchEvent('h0-open-artifact')`（与现状一致）
**依赖：** toolMeta 无关；独立组件。pptx 渲染参数与 PreviewPanel 保持一致（注释互指）。

### 前端：AssistantSteps.tsx / ChatThread.tsx（修改）

**职责：** 把现有两处内联 `artifact-card`（普通产物 + 脚本折叠区内）替换为 `<ArtifactCard>`；删除旧按钮 JSX 与 `artifact-card-*` 样式类（新类名 artifact-long-card-*）。
**依赖：** ArtifactCard。

### 前端：app.css（修改）

新增：长卡布局（flex）、图标尺寸、菜单浮层（阴影圆角，对齐 `.model-menu` 系）、子菜单定位、菜单项 hover/键盘焦点态、「默认」徽标、已复制反馈。复用现有色板。

## 模块交互

```
点击三点 → ArtifactMenu 打开
  ├─ 打开 → POST /workspace/files/open {path} → exec start → 成功关菜单/失败 toast
  ├─ 打开文件夹 → POST /workspace/files/reveal {path} → explorer /select
  ├─ 另存为 → <a href="/workspace/files/raw?path=…&download=1" download> 原生流程
  ├─ 复制路径 → GET stat → navigator.clipboard.writeText(absolutePath) → 「已复制」
  └─ 打开方式 → GET openwith?path=（首次，随后缓存）→ 子菜单列表
        └─ 点应用 → POST /workspace/files/open-with {path, appId} → Start-Process

点击卡片主体 → dispatch h0-open-artifact → TaskPage.openArtifactTab（现状不变）
```

## 文件组织

```
my-mastra-product/
├── src/mastra/server/
│   └── workspace-routes.ts        → 新增 5 个端点 + PowerShell 枚举脚本 + 缓存（改）
├── app/src/components/
│   ├── ArtifactCard.tsx           → 长卡 + FileIcon + ArtifactMenu（新建）
│   ├── AssistantSteps.tsx         → 替换两处内联产物按钮（改）
│   └── app.css                    → 长卡/菜单样式（改）
└── docs/spec/m13-*.md
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 系统操作执行层 | 后端 Mastra server（child_process + PowerShell），不用 Electron IPC | 后端就在本机，浏览器/桌面壳/移动同一套 API 全部可用；app-desktop 壳改动为零 |
| 应用枚举 | 单次 PowerShell 脚本完成注册表+图标并输出 JSON | Node 无注册表内置库；一次进程调用完成全部查询，避免多次往返；按扩展名缓存后首开延迟可接受（AC12） |
| 「打开方式」防注入 | appId→command 映射只存服务端内存，前端仅回传 id | 任意命令行不可能经前端注入（N2）；枚举缓存天然就是白名单 |
| 图标提取 | System.Drawing Icon.ExtractAssociatedIcon → PNG base64 | 无原生模块依赖；16-32px 显示尺寸下质量足够；失败降级通用图标（F2/F14） |
| 另存为 | 复用 raw 端点 + `<a download>` | 浏览器原生流程即 F8 定义；零后端改动（如需强制下载头，raw 端点加一个参数） |
| 绝对路径下发 | stat 返回 absolutePath 供复制 | 本机产品，路径对本用户不是秘密；与 N2 不冲突（执行仍全部走后端校验） |
| UWP 应用 | 名称可取则列出，启动走 shell:AppsFolder；否则跳过 | 覆盖 Edge 等常见 UWP；避免枚举脚本复杂度失控 |
| 菜单组件 | 手写浮层（不引 UI 库） | 项目现有菜单（模型选择/技能菜单）均为手写，保持一致与轻量 |
| M13 开发时机 | 排在 M12 验收后 | codex 单实例串行纪律；M12 批 2/3 未跑 |
