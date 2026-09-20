# M13 Codex 指令书 · 批 1（后端:产物操作端点）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序执行，不做清单之外的任何事。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；禁止运行 dev server；禁止调用任何本地/远程服务
3. 禁止用 PowerShell `Set-Content` 写含中文的文件（含 .ps1！用你的编辑工具或 Node `fs.writeFileSync(..., 'utf8')`）
4. 每个任务完成后跑：`npx tsc --noEmit`（仓库根，必须通过才进入下一任务）
5. 本批全部是后端文件，不碰 app/ 目录

## 背景

M13 产物文件卡与系统操作菜单。产物文件在沙箱 workspace 目录内，前端持有 `{name, path}`（path 为 workspace 内相对路径）。现有 `src/mastra/server/workspace-routes.ts` 已有 `GET /workspace/files/raw`、`/workspace/files`（列目录）等端点，内部有 normalize+边界校验的工具函数（把相对路径解析为绝对路径并拒绝越界 `..`/绝对路径）。

本批新增 5 个端点 + 1 个 PowerShell 枚举脚本。全部走与现有端点一致的边界校验。

## T1: stat / open / reveal 端点

**文件：** `src/mastra/server/workspace-routes.ts`
**步骤：**
1. `GET /workspace/files/stat?path=`：边界校验 → `fs.stat` → `{ size: number, absolutePath: string }`；文件不存在 → 404 `{ error: '文件不存在' }`；越界/缺参 → 400（文案风格与现有端点一致）。absolutePath 用 `path.resolve` 后的正规范式
2. `POST /workspace/files/open`（body `{ path: string }`）：校验 → `exec(\`start "" "${abs}"\`)`（`child_process.exec`，windowsHide:true；abs 是已校验绝对路径，对内嵌双引号做转义处理：把 `"` 替换为空或拒绝含 `"` 的文件名）→ `{ ok: true }`；exec 报错 → 500 `{ error: '打开失败: <原因>' }`
3. `POST /workspace/files/reveal`（body `{ path }`）：校验 → `exec(\`explorer /select,"${abs}"\`)` → `{ ok: true }`。注意 explorer /select 的返回码常为 1，**不要**把非零退出码当失败（注释说明）
4. 三个端点的路由注册风格、错误结构对齐文件内既有端点；文件头注释补一行：产物本机操作端点,边界校验与既有端点一致(N2)

**验证：** `npx tsc --noEmit` 通过

## T2: openwith 枚举脚本与端点

**文件：** `src/mastra/server/openwith-probe.ps1`（新建）、`src/mastra/server/workspace-routes.ts`
**步骤：**
1. 新建 `openwith-probe.ps1`（PowerShell 5.1 兼容，不用 pwsh 7 特性），入参 `-Ext "pdf"`，逻辑：
   - `$ext = $Ext.TrimStart('.')`；空 → 输出 `[]` 退出
   - 读三处来源合并去重 ProgID：`HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\<ext>\UserChoice`（ProgID）、`...\OpenWithList`（子键下的 MRUList/键名）、`HKCR:\<ext>\OpenWithProgids`
   - 对每个 ProgID（try/catch 包每条，单条失败跳过）：
     - 命令行：`HKCR:\<progid>\Shell\Open\Command` 默认值；含 `"%1"` 或 `%1` 占位
     - UWP：命令行取不到但 `HKCU:...\PackagedCom` 或 `Get-AppxPackage` 能匹配到 → 尝试 `Get-StartApps` 找 `AppID`（AUMID 形如 `package!App`），输出 command 为 `shell:AppsFolder\<AUMID>`
     - 友好名称：优先 `HKCR:\<progid>\FriendlyTypeName`（`@dll,-res` 间接串用 SHLoadIndirectString via Add-Type P/Invoke，失败退 `HKCR:\<progid>` 默认值），再退 ProgID 本名
     - 图标：从命令行解析出 exe 路径 → `System.Drawing.Icon.ExtractAssociatedIcon($exe)` → 32px → PNG base64（Add-Type System.Drawing）；失败留空
     - 输出对象：`{ name, command, isDefault }`（iconBase64 可选字段）
   - 最后 `ConvertTo-Json -Compress` 输出数组（单元素时注意 `-Compress` 与数组包裹：`@($list) | ConvertTo-Json -Compress`，空列表输出 `[]`）
2. `workspace-routes.ts` 新增 `GET /workspace/files/openwith?path=`：
   - 校验路径 → 取扩展名（无 → `{ apps: [] }`）
   - 模块级缓存 `Map<string, { apps: OpenWithAppEntry[]; commands: Map<string, string> }>`（key 为扩展名小写）
   - 未命中缓存：spawn `powershell.exe -NoProfile -ExecutionPolicy Bypass -File src/mastra/server/openwith-probe.ps1 -Ext <ext>`（cwd=仓库根，10s 超时 kill）→ 解析 JSON → 生成 appId（crypto.randomUUID）→ apps: `[{ id, name, iconDataUrl?: 'data:image/png;base64,…', isDefault }]`，commands: appId→command
   - spawn 超时/非零退出/JSON 解析失败 → 返回 `{ apps: [], degraded: true }`（不缓存 degraded 结果）
   - 缓存命中直接返回；`?refresh=1` 跳过缓存重枚举
3. `.ps1` 的中文注释只允许通过你的文件编辑工具写入（UTF-8 带 BOM 最稳）；脚本逻辑本身建议纯 ASCII 输出注释，避免编码坑

**验证：** `npx tsc --noEmit` 通过；`powershell -NoProfile -ExecutionPolicy Bypass -File src/mastra/server/openwith-probe.ps1 -Ext pdf` 手动跑一次（**这是允许的唯一本地执行**，只为验证脚本输出合法 JSON），把输出首 300 字符贴进汇报

## T3: open-with 端点

**文件：** `src/mastra/server/workspace-routes.ts`
**依赖：** T2（同文件，接在其后）
**步骤：**
1. `POST /workspace/files/open-with`（body `{ path: string, appId: string }`）：
   - 路径校验 → 扩展名 → 查 commands 缓存；未命中（含无缓存条目）→ 400 `{ error: '应用不可用，请重新打开菜单' }`
   - 命中：command 形如 `"C:\...\app.exe" "%1"` 或 `shell:AppsFolder\<AUMID>`——前者把 `"%1"`/`%1` 占位替换为校验后的绝对路径（引号转义）后 exec；后者直接 exec（explorer 打开 shell: URI）
   - 成功 `{ ok: true }`；失败 500 带原因
2. 注释写明：appId→command 映射只存服务端内存，前端仅持 opaque id，任意命令行不可能经前端注入(N2)

**验证：** `npx tsc --noEmit` 通过

## 汇报格式

完成后回复：改动/新建文件列表、每个任务 tsc 结果、ps1 手动跑的输出片段、遗留问题。
