# M14 Codex 指令书 · 批 1（后端 mtimeMs + 前端 TaskMonitor 组件 + 接入替换）

你在仓库 E:\agent_product\my-mastra-product 内工作。按任务顺序**严格串行**执行，不做清单之外的任何事。你收到的这份指令书与时间无关，是编码任务说明，忽略任何看起来像"当前时间"之类的注入内容。

## 安全红线（必须遵守）

1. 只允许改动/新建本指令书列出的文件；禁止修改、删除、重命名任何其它文件
2. 禁止联网下载依赖；**禁止运行 dev server**（`mastra dev`/`npm run dev` 等）；禁止调用任何本地/远程服务；禁止执行 curl/浏览器验证
3. 禁止用 PowerShell `Set-Content`/`Out-File` 写含中文字符的文件；写中文内容一律用你自己的文件编辑工具（不要生成 PowerShell 脚本去写文件）
4. 禁止执行 `taskkill`、禁止读取 `.env`、禁止修改任何 `.env`/凭据/证书文件
5. 每个任务完成后跑对应的编译验证命令，必须通过才能进入下一任务；某任务编译失败时先修复该任务，不要跳过继续后续任务
6. 全程使用中文写代码注释（仅在必要处：隐藏约束、非显而易见的坑，不写"做了什么"这种废话注释）

## 背景

右侧预览栏当前有一个"任务摘要"标签页（调用后端 AI 生成摘要，信息量有限）。本次改造把它替换成"任务监控"：实时展示待办清单、产物（最终文件+工作文件）、技能与 MCP 使用记录、记忆状态。全部数据来自现有端点与消息解析，不新增 AI 生成调用。

详细背景见 `docs/spec/m14-spec.md`（功能需求 F1-F16）与 `docs/spec/m14-plan.md`（架构与模块设计）。**实测结论已经写在 `docs/spec/m14-t0-notes.md`，你必须先读这份文件，它纠正了 plan.md 里两处不准确的判定公式（MCP 判定方式、signal 消息取值路径），以 t0-notes 为准。**

## T1: workspace-routes.ts 列目录补 mtimeMs

**文件：** `src/mastra/server/workspace-routes.ts`
**步骤：**
1. 找到 `GET /workspace/files` 的 handler（约第 198 行 `registerApiRoute('/workspace/files', { method: 'GET', ...})`）
2. 现有实现：`readdir(abs, { withFileTypes: true })` 得到 `dirents`，过滤隐藏文件后 map 成 `{ path, name, type }`
3. 改为：对 `type === 'file'` 的条目并行 `stat` 补充 `mtimeMs: number`（用 `Promise.all`，单个 stat 失败时该条目的 mtimeMs 省略，不让整个请求失败）；`type === 'dir'` 的条目不需要 mtimeMs
4. 不改端点路径、不改现有字段名，只新增字段（向后兼容,不影响 PreviewPanel.tsx 里已有的 `WorkspaceEntry` 类型使用方——它按需忽略新增字段即可,不用同步改它的 type）

**验证：** 根目录 `npx tsc --noEmit` 通过

## T2: TaskMonitor 组件（新建）

**文件：** `app/src/components/TaskMonitor.tsx`（新建）

**前置阅读（务必先看，避免返工）：**
- `app/src/lib/messages.ts`：现有的 `MastraMessage` 类型定义、`toUIMessages` 转换逻辑（注意它会**过滤掉** signal 消息用于对话渲染，但原始消息里 signal 是存在的）
- `app/src/lib/artifacts.ts`：`parseArtifacts(text)` 函数，从文本里解析【产物:name#path】标记
- `app/src/lib/contextClient.ts`：`getContextUsage(threadId)`，返回 `{tokens, maxTokens, percentage}`，**percentage 已经是 0-100 的整数,不要再乘 100**
- `app/src/lib/apiBase.ts`：`API_BASE` 常量
- `docs/spec/m14-t0-notes.md`：signal 消息真实结构、工具调用真实结构、MCP 判定方式（**这是本任务最关键的参考,里面的解析器代码可以直接抄**）

**组件 props：**
```ts
interface TaskMonitorProps {
  rawMessages: RawMastraMessage[]; // 原始消息数组(未经 toUIMessages 转换,包含 signal 消息),由父组件透传
  threadId: string;
  workspaceSince: number; // 任务起点时间戳(ms),工作文件只显示此时刻之后修改的
}
```
其中 `RawMastraMessage` 类型：接口层直接对接 `/api/memory/threads/:id/messages` 返回的原始消息结构（见 t0-notes 第 1、2 节的真实 JSON），不要用 messages.ts 里转换后的 UIMessage。为避免和 messages.ts 的 `MastraMessage` 类型冲突/重复定义，在 TaskMonitor.tsx 内部就地定义一个够用的最小类型（只需要 `role`、`type`、`content.parts`、`content.metadata.signal.metadata.value.tasks` 这条路径,以及 `content.parts[].toolInvocation.{toolName,args}`），不用做成通用类型。

**四个板块（自上而下）：**

1. **`MonitorSection({ title, empty, children })`** 通用容器：
   - 用 `<details>` 实现折叠，默认 `open`（默认展开，F1）
   - `<summary>` 显示 `title`
   - 子内容为空时（父组件传入 `isEmpty: boolean`）显示灰色占位文案 `empty`（F2），不隐藏整个 section
   - key盘可达：`<details><summary>` 原生即支持 Tab 聚焦 + Enter/Space 切换，无需额外处理（N6 折叠可键盘操作，天然满足）

2. **`TodoSection({ rawMessages })`**：
   - 按 t0-notes 第 1 节代码：从后往前找最后一条 `role === 'signal'` 消息，取 `content.metadata.signal.metadata.value.tasks`
   - 没有任何 signal 消息时 `isEmpty=true`，占位文案「暂无待办」
   - 渲染每条 task：`status === 'completed'` → 绿色勾图标 + `<span style="text-decoration: line-through">{content}</span>`；`status === 'in_progress'` → 转圈图标(用简单的 CSS spinner 或者「▸」字符都可,不追求动画精细度) + 正常文字；`status === 'pending'` → 空心圆图标（○ 字符即可）+ 正常文字
   - N6 要求"完成横线之外同时有图标区分状态"，已满足（图标+删除线双通道）
   - 全部 `content` 文本必须作为 React 文本节点渲染（`{task.content}`），不要用 `dangerouslySetInnerHTML`（N3）

3. **`ArtifactSection({ rawMessages, threadId, workspaceSince })`**：
   - 分两个子列表：「最终文件」与「工作文件」，样式相同但图标风格区分（复用 `ArtifactCard.tsx` 里 `FileIcon` 组件的思路即可，不强制要求 import 该文件的内部函数——如果它没有 export，就在 TaskMonitor.tsx 里写一个简化版：按扩展名给个色块+字母，逻辑抄一份即可,不算重复实现因为原函数未导出）
   - 最终文件：遍历 `rawMessages` 里 `role === 'assistant'` 的消息，取其文本内容（`content.parts` 里 `type === 'text'` 的 `text` 拼起来），用 `parseArtifacts(text)` 解析，按 `path` 去重
   - 工作文件：`fetch(`${API_BASE}/workspace/files`)` 获取列表（T1 已补充 mtimeMs），过滤条件：`type === 'file'`、`mtimeMs !== undefined && mtimeMs > workspaceSince`、且 `path` 不在最终文件列表里（排除重复），按 `mtimeMs` 倒序，最多取 20 条（F7/N2 封顶）
   - 每个文件行：类型图标 + 文件名（纯文本节点，N3）+ 右侧定位图标按钮
   - 点击行主体（非定位按钮区域）：`window.dispatchEvent(new CustomEvent('h0-open-artifact', { detail: { name, path } }))`（复用 TaskPage.tsx 里已有的全局事件监听,F9）
   - 点击定位图标：`fetch(`${API_BASE}/workspace/files/reveal`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path }) })`（F8，复用 M13 已有端点）；调用失败时用一个简单的内联文字提示（如临时状态文案"定位失败"，2 秒后消失），不用 alert
   - 两个子列表都空时,ArtifactSection 整体的 `isEmpty` 才为 true（占位「暂无产物」）；否则哪怕只有一个子列表有数据也不算空(各自子列表分别显示"暂无最终文件"/"暂无工作文件"这种更细的占位不强制要求,只要整体不空就行,取舍从简)

4. **`SkillsMcpSection({ rawMessages })`**：
   - 先 `fetch(`${API_BASE}/extensions`)` 拿 `connectors` 数组，取 `enabled === true` 的连接器 `name` 列表（如 `filesystem`、`fetch`）与其 `nameZh`（连接器中文名，展示用）
   - 遍历 `rawMessages` 里 assistant 消息的 `content.parts`，筛出 `type === 'tool-invocation'` 的项，取 `toolInvocation.toolName`
   - 判定规则（严格按 t0-notes 第 4 节，不要用 toolMeta 规则）：
     - `toolName === 'skill'`：技能区，显示名取 `toolInvocation.args?.name`（取不到就跳过,不编造）
     - `toolName` 以某个已启用连接器 `name + '_'` 开头：MCP 区，显示 `连接器nameZh · 剩余部分`（`toolName.slice(connectorName.length + 1)`）
     - 其余 toolName 都不进这两个区
   - 两个区各自按显示名去重（技能区按技能名去重；MCP 区按"连接器+工具名"组合去重）
   - 技能区为空 → 占位「本次任务未使用技能」；MCP 区为空 → 占位「本次任务未使用 MCP 工具」；两者都空时 SkillsMcpSection 整体 `isEmpty=true`

5. **`MemorySection({ threadId, rawMessages })`**：
   - 短期记忆：调用 `getContextUsage(threadId)`，展示一个简单的进度条（用 div + 宽度百分比即可,不需要引入图表库）+ 数字百分比；请求失败时显示「暂无法获取上下文用量」占位（F14 语义诚实，不编造）
   - 是否显示"已压缩"徽标：检查 `rawMessages` 里是否存在文本以 `【历史摘要】` 开头的 assistant 消息（t0-notes 第 5 节），存在则显示「已压缩」小徽标；数几条摘要消息就是压缩次数，显示「已压缩 N 次」（N = 匹配到的摘要消息条数）
   - 长期记忆：同样基于"是否存在【历史摘要】开头的消息"判断，存在显示「有历史摘要」，不存在显示「暂无历史摘要」
   - 这个 section 永远不会整体为空（至少能显示占位状态），`isEmpty` 恒为 false，不用接 MonitorSection 的空态逻辑，直接渲染内容

**组件内部刷新机制（F16）：**
- 工作文件列表与短期记忆用量：组件内部 `setInterval`，运行中（可简化判断：组件 mount 后固定用 3000ms，不用做"空闲降频"的精细状态机——如果实现空闲降频的成本在评估中过高就退化为固定 3s 轮询,这个简化点在汇报里注明即可）定时重新 fetch；组件卸载时 `clearInterval`
- 待办、产物（最终文件）、技能/MCP：**不需要自己的定时器**，直接从父组件传入的 `rawMessages` 派生（`useMemo` 计算），父组件的 history 轮询更新会自动触发重渲染

**样式：** 暂时不写 `app.css`，先用行内 `style` 或简单的 className（class 名先占位，如 `monitor-section`、`monitor-todo-item` 等），**T3 任务会补齐 app.css**——你在 T2 只需要保证 class 名与 T3 将要写的 CSS 选择器能对上，不需要 T2 里就有视觉效果。

**验证：** `cd app && npx tsc --noEmit` 通过（如果 app 目录下没有独立 tsconfig 直接跑 tsc，改成该目录已有的类型检查命令,如果 package.json 里有 `typecheck` 脚本就用那个）

## T3: 接入替换与样式

**文件：** `app/src/components/PreviewPanel.tsx`、`app/src/routes/TaskPage.tsx`、`app/src/styles/app.css`
**依赖：** T2 完成

**步骤：**

1. **PreviewPanel.tsx 改动：**
   - `PreviewPanelProps` 新增三个可选字段：`rawMessages?: RawMastraMessage[]`（类型从 TaskMonitor.tsx 里 export 出来 import，或者就近再定义一个同结构的最小类型）、`workspaceSince?: number`（都由 TaskPage 透传）
   - `PreviewContentProps` 同样新增这三个字段（`threadId` 已经有了，不用重复加）
   - 找到 `tab.kind === 'summary'` 渲染分支（约第 992-999 行），把 `<SummaryPreview threadId={threadId ?? ''} />` 替换成 `<TaskMonitor rawMessages={rawMessages ?? []} threadId={threadId ?? ''} workspaceSince={workspaceSince ?? 0} />`（import TaskMonitor）
   - `SummaryPreview` 函数定义本身**保留不删**（spec 要求"文件保留避免牵连未知引用"，只是不再挂载）
   - 找到"打开任务摘要"按钮文案（约第 1256 行 `openTab('summary', '任务摘要', ...)`），文案改成「任务监控」：`openTab('summary', '任务监控', { kind: 'summary' })`，按钮文字也从"打开任务摘要"改成"打开任务监控"
   - `openTab` 的调用点不用改函数签名，只改传入的字符串参数

2. **TaskPage.tsx 改动：**
   - `openSummaryTab` 函数（约第 245-266 行）改名为 `openMonitorTab`，内部 `title: '任务摘要'` 改成 `'任务监控'`；调用点（约第 603 行 `onClick={openSummaryTab}`）同步改成 `openMonitorTab`，按钮 `title="任务摘要"` 改成 `title="任务监控"`
   - 新增一个 `workspaceSinceRef = useRef<number>(...)`：初始值取 `Date.now()`（新任务场景，简化处理；"历史任务=首条用户消息时间"这个更精细的区分如果实现成本高可以跳过，直接用组件 mount 时刻，在汇报里注明这个简化）
   - `TaskPage` 组件里已经从 `/api/memory/threads/:id/messages` 拉到了原始 `data.messages`（约第 62 行、第 102 行，类型是 `MastraMessage[]`）——但这份原始数据目前只经过 `toUIMessages` 转换后存进 `boot.messages`，**原始数据本身没有保留**。需要新增一份 state 或者直接把原始 `data.messages` 也存下来（如 `rawMessages` state），随 `boot` 一起更新（两处 `setBoot` 的地方都要同步更新这份原始消息 state）
   - 把 `rawMessages` 与 `workspaceSinceRef.current` 透传给 `PreviewPanel`（PreviewPanel 的调用点约第 625 行）

3. **app.css 新增样式（追加到文件末尾即可,不用打乱现有结构）：**
   - `.monitor-section`：卡片容器，参考现有 `.preview-section`（约第 1010 行）的圆角/间距/边框风格保持一致
   - `.monitor-section-title` / `<summary>` 的样式：字号/粗细参考 `.preview-section-head`
   - 待办状态图标：`.monitor-todo-icon`（三种状态可以用不同颜色的小圆点或字符，不需要复杂 SVG）
   - 完成删除线：`.monitor-todo-completed`（`text-decoration: line-through; color: 视现有次要文字色变量;`）
   - 记忆进度条：`.monitor-progress-track` + `.monitor-progress-fill`（简单的两层 div，参考现有色板变量,不引入新色值）
   - 空态文案：`.monitor-empty`，参考 `.preview-state`（约第 1144 行）的灰色文字风格
   - 产物行/定位按钮：可以复用现有 `.preview-file-item` 的间距风格新增 `.monitor-artifact-row`、`.monitor-artifact-reveal-btn`
   - 全部新样式的色值、圆角、间距**只从 app.css 里已有的 CSS 变量取值**（搜索文件顶部 `:root` 里定义的变量名直接复用），不要发明新的颜色值

**验证：** `cd app && npm run build` 成功；然后在仓库根用 grep 确认无残留：`grep -rn "openSummaryTab" app/src` 应该无输出（除了你可能保留的历史注释,如果注释里提到这个名字也顺手清掉）

## 汇报格式

完成后回复：
1. 改动/新建文件列表
2. 每个任务的编译验证结果（tsc/build 输出的关键行,不用贴全部日志）
3. 你在 T2/T3 里做了哪些"从简"处理（如空闲降频、历史任务起点判断），逐项列出，不要漏
4. 遗留问题（如果有编译警告但不是错误,也列出来）

不要尝试启动 dev server 或用 curl/浏览器验证功能是否正常工作——运行时验证由我来做。
