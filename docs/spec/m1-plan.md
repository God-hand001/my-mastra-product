# M1 联网搜索 Plan

> 输入:已批准的 [m1-spec.md](./m1-spec.md)

## 架构概览

M0 架构零变动,只在后端工具层新增一个模块:

```
用户任务 → agent(DeepSeek)
              ├─ web_search 工具(新增)→ Tavily API → 返回编号结果 + 现成"来源"小节 markdown
              ├─ web_fetch / workspace / schedule(不动)
              └─ 回答:正文 [1][2] 标注 + 末尾来源小节 → 前端原样渲染(Markdown 已支持)
```

**核心思路:让工具替 agent 干"编号"和"来源列表排版"的粗活** —— 工具返回时就带好 `[1]..[n]` 编号和一份可直接粘贴的来源小节 markdown,agent 只需正确引用。

## 核心接口

**`web_search` 工具(`createTool` 定义)**

```ts
id: 'web_search'
inputSchema:  { query: string(搜索词), maxResults?: number(默认 5) }
execute:      fetch Tavily /search(Bearer 认证,AbortSignal.timeout(15000))
outputSchema: {
  results: [{ index, title, url, snippet }],   // index 从 1 开始
  sourceListMarkdown: string,                  // "## 来源\n1. [标题](URL)\n2. ..."
  hint: string,                                // 给 agent 的引用格式说明
}
失败时:返回 { results: [], error: '原因' }(不 throw,保证 N1 不阻塞任务)
```

**agent.ts 变更**

- `tools` 增加一项:`web_search: webSearchTool`
- `instructions` 增加一小节:何时该搜(时事/知识不确定)、引用格式(`[n]` 接续编号、末尾附来源小节)、安全约束(不把本地文件内容/密钥写进搜索词)

## 模块设计

| 模块 | 职责 | 依赖 |
|------|------|------|
| `src/mastra/tools/web-search-tool.ts`(新建) | Tavily 调用、超时控制、结果编号、来源小节生成、失败降级 | 仅 `@mastra/core/tools` + zod |
| `src/mastra/agents/agent.ts`(修改) | 注册工具 + instructions 引用规范 | web-search-tool |
| `app/`(前端) | **零改动**(N4) | — |
| `.env.example` | 补 `TAVILY_API_KEY=占位符` | — |

## 模块交互

任务执行 → agent 判断需要外部信息 → 调用 `web_search`(工具卡片自动展示)→ 工具调 Tavily → 编号结果返回 → agent 组织回答:正文 `[n]` 标注 + 末尾粘贴来源小节 → 前端 Markdown 渲染(引用链接可点击)。

## 文件组织

```
my-mastra-product/
├── src/mastra/
│   ├── tools/
│   │   └── web-search-tool.ts   # 新建:Tavily 工具(供应商细节全部在此)
│   └── agents/agent.ts          # 修改:注册工具 + instructions 引用规范
├── .env.example                 # 补 TAVILY_API_KEY 占位符
└── docs/spec/m1-*.md            # spec/plan/task/checklist
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 编号归属 | 工具内编号(每轮 1..n)+ instructions 要求跨轮接续 | 让模型自由编号错误率高;工具预编号最稳,多轮接续交由 instructions 兜底 |
| 失败处理 | 返回 error 字段而非 throw | throw 会让整个任务失败;返回错误信息让 agent 自行决策(N1) |
| HTTP 客户端 | 原生 fetch + AbortSignal.timeout(15s) | Node 22 内置,零依赖,满足 N1 |
| 搜索深度 | Tavily 默认档(max_results=5,basic depth) | spec 不做的事:不做高级调优 |
| 前端 | 零改动 | 来源列表是回答文本,Markdown 渲染已就绪(N4) |
