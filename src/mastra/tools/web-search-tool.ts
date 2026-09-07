import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// 联网搜索工具(M1)
// F5 供应商隔离:Tavily 的接口细节(端点、鉴权、字段)全部封装在本文件,
// agent 配置与前端只感知通用的"搜索 → 编号结果 → 来源小节"概念。
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 5;
const SNIPPET_MAX_CHARS = 300;

interface TavilyResult {
  url?: string;
  title?: string;
  content?: string;
}

export const webSearchTool = createTool({
  id: 'web_search',
  description:
    'Search the public web for current or unknown information. Returns numbered results (index/title/url/snippet) plus a ready-to-append "来源" markdown section. Use for news, facts you are unsure about, or external topics. Never include local file contents or secrets in the query.',
  inputSchema: z.object({
    query: z.string().min(1).describe('搜索词,中英文皆可'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('返回条数,默认 5'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        index: z.number(),
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      }),
    ),
    sourceListMarkdown: z.string(),
    hint: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ query, maxResults }) => {
    const hint =
      '回答引用搜索结果时:正文用 [n] 标注(n 为结果编号);若本次回答已使用过先前搜索的编号,从已有最大编号之后接续;回答末尾原样附上 sourceListMarkdown。';

    const limit = maxResults ?? DEFAULT_MAX_RESULTS;
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        results: [],
        sourceListMarkdown: '',
        hint,
        error: '未配置 TAVILY_API_KEY,无法执行搜索',
      };
    }

    try {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, max_results: limit }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          results: [],
          sourceListMarkdown: '',
          hint,
          error: `搜索服务返回 ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        };
      }

      const data = (await res.json()) as { results?: TavilyResult[] };
      const results = (data.results ?? []).slice(0, limit).map((r, i) => ({
        index: i + 1,
        title: r.title?.trim() || '(无标题)',
        url: r.url ?? '',
        snippet: (r.content ?? '').slice(0, SNIPPET_MAX_CHARS),
      }));

      const sourceListMarkdown = results.length
        ? ['## 来源', ...results.map(r => `${r.index}. [${r.title}](${r.url})`)].join('\n')
        : '';

      return { results, sourceListMarkdown, hint };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { results: [], sourceListMarkdown: '', hint, error: `搜索失败: ${reason}` };
    }
  },
});
