# M13 Codex 指令书 · 批 3（接入替换 + 样式收口）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序执行，不做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；禁止运行 dev server / vite；禁止调用任何本地/远程服务
3. 禁止用 PowerShell `Set-Content` 写含中文的文件
4. 完成后跑：`cd app && npx tsc --noEmit` 与 `cd app && npm run build`（都必须通过）

## 背景

批 1（后端 5 端点）、批 2（`app/src/components/ArtifactCard.tsx`：长卡 + FileIcon + 大小懒加载 + InlinePreview(pptx/html) + ArtifactMenu 五项含打开方式子菜单）已完成并验证。批 2 遗留：菜单/卡片样式以内联 style 实现。

本批：① 把 `AssistantSteps.tsx` 里两处旧内联产物按钮替换为 `<ArtifactCard>`；② 将 ArtifactCard 的内联样式提取到 `app.css`（含批 2 清单要求）；③ 全局收口检查。

## T6a: 接入替换

**文件：** `app/src/components/AssistantSteps.tsx`
**步骤：**
1. 阅读 AssistantText 内 `otherArtifacts` 与 `scriptArtifacts` 两处渲染块
2. 两处的 `<button className="artifact-card" ...>` 整块替换为 `<ArtifactCard artifact={a} />`（openArtifact 局部闭包若不再被引用则删除；h0-open-artifact 事件由 ArtifactCard 派发，事件名不变）
3. scriptArtifacts 的折叠容器（details）保留，内部替换为 ArtifactCard
4. 确认 SourceBadge、网页卡、stripArtifactMarkers 逻辑不变

## T6b: 样式提取

**文件：** `app/src/components/ArtifactCard.tsx`、`app/src/styles/app.css`
**步骤：**
1. 将 ArtifactCard 内所有内联 `style={{...}}` 迁移到 app.css 的语义类（`.artifact-long-card`、`.artifact-icon`、`.artifact-name`、`.artifact-sub`、`.artifact-menu`、`.artifact-menu-item`、`.artifact-menu-error`、`.artifact-submenu`、`.artifact-inline`、`.artifact-inline-fail`、`.artifact-openwith-row`、`.artifact-default-badge` 等），组件内改用 className
2. 样式值沿用批 2 现值（色板/尺寸不变），只做迁移；如批 2 用到的 FileIcon 色块是动态色（按 ext 映射）保留 style 方式但抽成 FileIcon 内的常量表
3. app.css 追加规则放文件末尾，中文注释分节
4. 不删除旧 `.artifact-card` 样式前先全局 grep 确认无引用再删（AssistantSteps 替换后应无引用）

## T6c: 收口检查

1. `grep -rn "artifact-card\b" app/src` 无 JSX 引用残留（旧样式类删除）
2. `cd app && npm run build` 通过
3. 验证 ArtifactCard 的 h0-open-artifact 事件 detail 结构与 TaskPage 消费端期望一致（{name, path}）

## 汇报格式

完成后回复：改动文件、tsc/build 结果、迁移的样式类清单、grep 收口证据、遗留问题。
