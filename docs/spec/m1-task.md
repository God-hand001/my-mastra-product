# M1 联网搜索 Tasks

> 输入:[m1-spec.md](./m1-spec.md) + [m1-plan.md](./m1-plan.md)
> 前置:Tavily key 已存入 `.env` 并验证可用

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mastra/tools/web-search-tool.ts` | Tavily 搜索工具(编号/来源小节/失败降级) |
| 修改 | `src/mastra/agents/agent.ts` | 注册 web_search + instructions 引用规范 |
| 修改 | `.env.example` | 补 TAVILY_API_KEY 占位符 |
| 新建 | `docs/spec/m1-checklist.md` | 验收清单 |

## T1: web_search 工具实现

**文件:** `src/mastra/tools/web-search-tool.ts`(新建)
**依赖:** 无
**步骤:**
1. 用 `createTool` 定义 `webSearchTool`:`id: 'web_search'`,inputSchema `{ query: z.string(), maxResults: z.number().optional() }`
2. `execute` 内:POST `https://api.tavily.com/search`,Bearer 认证(key 读 `process.env.TAVILY_API_KEY`),body `{ query, max_results: maxResults ?? 5 }`,`AbortSignal.timeout(15000)`
3. 结果映射:`results[].{index: i+1, title, url, snippet: content 截断 300 字}`
4. 生成 `sourceListMarkdown`(`## 来源` + `n. [标题](URL)` 逐条)与 `hint`(引用格式说明)
5. 失败分支:fetch 异常/超时/非 200/缺 key → 返回 `{ results: [], error: '<原因>' }`,不 throw
6. 输出用 outputSchema 约束

**验证:** 临时在文件尾部加自测代码(直接调用 execute)用 `npx tsx` 或 node 跑一次中文 query,确认返回编号结果与来源小节;验证后删除自测代码。`./node_modules/.bin/tsc --noEmit`(在 app/ 目录跑前端不涉及;后端用 `npm run dev` 启动无报错)

## T2: agent 注册工具 + instructions

**文件:** `src/mastra/agents/agent.ts`、`.env.example`
**依赖:** T1
**步骤:**
1. 导入 `webSearchTool`,`tools` 增加 `web_search: webSearchTool`
2. instructions 增加搜索与引用规范小节:
   - 何时搜:时事、不确定的事实、用户问外部信息
   - 如何引用:正文用 `[n]` 标注;多轮搜索接续编号(取已有最大编号续排)
   - 回答末尾:如使用了搜索,附上工具返回的来源小节 markdown
   - 安全:不把本地文件内容、密钥等敏感信息放进搜索词
3. `.env.example` 补 `TAVILY_API_KEY=tvly-你的key`

**验证:** dev server 热重载无报错;Studio 或界面发"查一下 JLCPCB 是什么公司" → 工具卡片出现且回答带编号

## T3: 按 checklist 验收

**文件:** `docs/spec/m1-checklist.md`(阶段四生成)
**依赖:** T2
**步骤:** 阶段六执行:逐项运行 checklist,记录证据,出验收报告

## 执行顺序

```
T1 → T2 → T3
```
