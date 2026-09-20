# M14-T0 实测记录：signal 消息与工具调用形态

> 实测方式：起 dev server，用 `curl -X POST /chat/agent`（带 `memory:{thread,resource}`）触发一个多步任务，
> 再用 `GET /api/memory/threads/:id/messages?agentId=agent&resourceId=local-user` 拉取原始存储消息核对。
> 探针线程：`m14-t0-probe2`（resourceId=local-user）。

## 1. signal 消息形态（待办快照/增量）

`role: 'signal'`，`type` 字段就是 tagName（`current-task-list` 或 `task-list-update`）。**关键结论：
`content.metadata.signal.metadata.value.tasks` 每次都是完整任务数组（不是只有变更项）**——
不管是 snapshot（`current-task-list`）还是 delta（`task-list-update`），`value.tasks` 都是当时的全量任务列表。
所以前端解析器不需要自己 diff/合并，直接取**最新一条 signal 消息**的 `content.metadata.signal.metadata.value.tasks` 即可得到当前待办全量状态。

```json
{
  "role": "signal",
  "type": "current-task-list",           // 或 "task-list-update"
  "content": {
    "format": 2,
    "parts": [{ "type": "text", "text": "\n  ▸ [in_progress] ...\n" }],
    "metadata": {
      "signal": {
        "id": "...", "type": "state", "tagName": "current-task-list",
        "createdAt": "...", "acceptedAt": "...",
        "attributes": { "count": 3 },        // 或 { "changes": 1 } for delta
        "metadata": {
          "value": {
            "tasks": [
              { "id": "t1", "content": "...", "status": "in_progress", "activeForm": "..." },
              { "id": "t2", "content": "...", "status": "pending", "activeForm": "..." }
            ]
          },
          "delta": { "ops": [...] },          // 只在 task-list-update 里有，可忽略不用
          "state": { "id": "tasks", "cacheKey": "...", "mode": "snapshot|delta", "threadId": "...", "version": 1 }
        }
      }
    }
  }
}
```

**解析器写法（T2 用）：**
```ts
function parseLatestTodos(history: MastraMessage[]): TodoItem[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'signal') continue;
    const tasks = (m.content as any)?.metadata?.signal?.metadata?.value?.tasks;
    if (Array.isArray(tasks)) return tasks; // 已是 {id,content,status,activeForm}[]
  }
  return [];
}
```
- status 枚举值：`'pending' | 'in_progress' | 'completed'`（与 spec TodoItem 一致，不用改字段名）。
- `messages.ts` 里现有的 `isInternalTaskListSignal` 只是把这类消息从**对话渲染**里过滤掉，
  不影响我们在 TaskMonitor 里单独扫 `history` 拿 signal 消息（TaskPage 需要把过滤前的原始 history 一并传给 TaskMonitor，
  或者 TaskMonitor 自己再请求一次 `/api/memory/threads/:id/messages` 原始接口——**建议后者**，
  因为 `toUIMessages` 转换后的 UIMessage 已经把 signal 过滤丢弃，TaskPage 手上可能已经没有原始 signal 消息了。
  **T2 实现前必须先确认 TaskPage 传给 PreviewPanel 的 `history` 是 UIMessage[] 还是原始 MastraMessage[]**——
  如果是 UIMessage[]，TaskMonitor 需要自己单独 fetch 原始消息列表来拿 signal。

## 2. 待办工具调用记录（toolInvocation，在 assistant 消息里）

- `task_write`：`args.tasks: TaskItem[]`（初始规划，全量数组）
- `task_update`：`args: {id, status?, content?, activeForm?}`
- `task_complete`：`args: {id}`
- 均 `toolName` 无命名空间前缀，直接是 `task_write`/`task_update`/`task_complete`（`task_check` 未在本次探测触发）。
- `toolMeta.ts` 已有规则命中这三个（`/task_write|task_update/i`、`/task_complete/i`），因此 T2 的 SkillsMcpSection
  **不能**把 task_* 系列误判成"技能"——它们既不含 "skill" 关键字也不是连接器命名空间，正常不会误判，但要注意别用过宽的正则。

## 3. 技能工具调用形态

- 探针里模型只调用了 `skill_search`（args: `{query, skillNames?, topK?}`），未触发 `skill`（激活技能）本身。
- 参照 `node_modules/@mastra/core/dist/workspace-smVhYwIC.js:5931/5959/6003`，内置技能工具族固定为三个、**无前缀**：
  - `skill`（激活技能，`args.name` = 技能名）
  - `skill_search`（跨技能搜索，`args.query`，无技能名字段）
  - `skill_read`（读取技能引用文件）
- **结论**：技能区应该按 `toolName === 'skill'` 取 `args.name` 作为显示名；`skill_search`/`skill_read` 只能算"用到了技能能力"但拿不到具体技能名（`skill_read` 应该有 path 参数，可尝试取 `args.path` 的技能名部分，但探针未触发，留给 T2 实现时做防御性兜底：拿不到名字就跳过不计入列表，不编造）。

## 4. 连接器（MCP）工具调用形态 —— 重要：plan 里的判定公式需要修正

实测 `filesystem` 连接器的写文件调用：
```json
{"toolName":"filesystem_write_file","args":{"path":"E:\\...\\m14test.txt","content":"hello"}, ...}
```
**问题**：`toolMeta.ts` 的规则 `/write_file|write|edit/i` 会命中 `filesystem_write_file`（因为它字面包含 `write_file`），
`findRule` 会返回"正在创建文件"规则而不是 undefined。plan 里"toolMeta 规则未命中 + 含 `_` 命名空间前缀 → MCP"
这条判定公式**在真实数据上是错的**：连接器工具名本身经常撞上 toolMeta 的宽泛关键字规则（write/read/list 等），不能用"规则未命中"当 MCP 判据。

**修正后的判定方式（T2 采用）**：
1. 先拉一次 `GET /extensions` 的 `connectors` 数组，取所有 `enabled === true` 的连接器 `name`（如 `filesystem`、`fetch`、`git`...）。
2. 对每个 assistant 消息里的 toolInvocation，若 `toolName` 以 `${connectorName}_` 开头（`connectors` 中任一名字），
   判定为 MCP 工具，显示 `连接器中文名(nameZh) · 剩余部分`（如 `文件系统 · write_file`）。
3. 否则若 `toolName === 'skill'`，按第 3 节处理进技能区。
4. 其余（`task_*`、`mastra_workspace_*`、`html_to_docx` 等内置工具）都不进这两个区。
- 内置 workspace 工具固定带 `mastra_workspace_` 前缀（如 `mastra_workspace_read_file`），与连接器工具（无 mastra 前缀）在数据层面本就可区分，不依赖 toolMeta 规则命中与否。
- 因此 **T2 不再依赖 stripToolPrefix/findRule 做 MCP 判定**，只需要一次 `/extensions` 拉取 + 前缀匹配。

## 5. 短期/长期记忆

- `GET /threads/:id/context` 实测返回：`{"tokens":3904,"maxTokens":524288,"percentage":1}`（percentage 已是 0-100 的整数百分比，不是 0-1 小数——T2 进度条直接用该值，不要再乘 100）。
- 长期记忆（历史摘要）：压缩后的摘要消息文本前缀固定为 `【历史摘要】`（`src/mastra/server/context-routes.ts:135`），
  判定"有历史摘要"＝ history 中存在文本以 `【历史摘要】` 开头的消息。

## 6. 给 T2 的其它确认事项

- workspace 文件写入接口实测返回路径可能是**绝对路径**字符串（工具执行结果里出现 `E:\agent_product\...\workspace\m14test.txt`），
  但这是工具执行结果文本，不是 `/workspace/files` 列目录接口返回；列目录接口（T1 改造对象）本身字段不变，只加 `mtimeMs`。
- `task_write` 在无 memory 挂载的裸 `/api/agents/agent/stream` 调用下会失败（"Task tools require agent memory"）；
  必须通过 `/chat/agent` 端点并带 `memory:{thread,resource:'local-user'}` 才能正常触发 signal 落库，
  T4 端到端验收时如果用 curl 直连要注意走这个端点/参数，不要用 `/api/agents/agent/stream`。
