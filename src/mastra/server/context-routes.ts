import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import type { MastraDBMessage } from '@mastra/core/agent/message-list';

// 上下文统计与压缩(HTTP 路由)
// - GET /threads/:threadId/context:统计当前线程上下文占用(%)
// - POST /threads/:threadId/compress:用模型摘要早期消息后删除,释放上下文空间

const AGENT_ID = 'agent';
const RESOURCE_ID = 'local-user';

// 上下文窗口上限(token);当前按 0.9M 窗口估算(0.9 × 1024 × 1024),实际窗口取决于所用模型与网关,后续应按模型动态取值
const MAX_CONTEXT_TOKENS = 943718;

// 按字符数估算 token:中英混合文本,1 token ≈ 2.5 字符(偏保守,实际略高)
function estimateTokensByChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 2.5);
}

// 递归提取消息中的全部文本(含工具调用/结果)
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractText).join('');
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    let result = '';
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' || typeof val === 'object') {
        result += extractText(val);
      }
    }
    return result;
  }
  return '';
}

// 是否为前端会渲染成对话气泡的消息(对齐 app/src/lib/messages.ts 的 toUIMessages 过滤逻辑:
// 只有 user/assistant 且解析出非空文本才会显示为气泡;task-list 类 signal、工具调用等
// 内部消息不会显示在对话区,不该计入压缩门槛——否则用户看到的可能只有一两句对话,
// 却因为内部信号/工具调用消息凑够了原始存储条数而被允许压缩,体感上"莫名其妙就压缩了"
// (2026-09-20 用户反馈:重开一个旧任务只看到两条气泡,点压缩却真的执行了)。
function countVisibleMessages(messages: MastraDBMessage[]): number {
  return messages.filter(m => {
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    return extractText(m.content).trim().length > 0;
  }).length;
}

// 计算一组消息对应的估算 token 数(含结构性开销)
function calcMessagesTokens(messages: MastraDBMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += extractText(msg.content).length;
    // 每条消息本身有结构性开销(role/metadata 等)
    totalChars += 64;
  }
  return estimateTokensByChars(totalChars);
}

// 读取线程全部消息(不存在/失败时返回 null)
async function getThreadMessages(mastra: Mastra, threadId: string) {
  const agent = await mastra.getAgent(AGENT_ID);
  const memory = await agent.getMemory();
  if (!memory) return null;
  try {
    const { messages } = await memory.recall({
      threadId,
      resourceId: RESOURCE_ID,
      perPage: false,
    });
    return messages;
  } catch {
    return null;
  }
}

export const contextRoutes = [
  registerApiRoute('/threads/:threadId/context', {
    method: 'GET',
    handler: async c => {
      const mastra = c.get('mastra');
      const threadId = c.req.param('threadId');
      const messages = await getThreadMessages(mastra, threadId);
      if (!messages) {
        return c.json({ tokens: 0, maxTokens: MAX_CONTEXT_TOKENS, percentage: 0 });
      }
      const tokens = calcMessagesTokens(messages);
      const percentage = Math.min(100, Math.round((tokens / MAX_CONTEXT_TOKENS) * 100));
      return c.json({ tokens, maxTokens: MAX_CONTEXT_TOKENS, percentage });
    },
  }),

  registerApiRoute('/threads/:threadId/compress', {
    method: 'POST',
    handler: async c => {
      const mastra = c.get('mastra');
      const threadId = c.req.param('threadId');
      const messages = await getThreadMessages(mastra, threadId);
      // 门槛按用户在界面上能看到的对话气泡数计算,不是原始存储消息数(见 countVisibleMessages 注释)
      if (!messages || countVisibleMessages(messages) < 4) {
        return c.json({ ok: false, reason: '消息太少，无需压缩' }, 400);
      }

      const agent = await mastra.getAgent(AGENT_ID);
      const memory = await agent.getMemory();
      if (!memory) return c.json({ ok: false, reason: '内存不可用' }, 500);

      // 保留边界按 token 预算从后往前确定,而不是固定条数:近几条消息里若混着
      // 网页抓取/图片 base64 这类巨型工具结果,固定"保留 2 条"会原样留下庞然大物,
      // 压缩后总量依然顶格(2026-09-20 用户实测:压缩显示成功但百分比纹丝不动)。
      // 预算取窗口上限的 5%,保证压缩后"摘要 + 保留消息"有实质下降;同时始终
      // 至少保留最后 1 条消息,避免把用户刚发的请求也摘要掉。
      const KEEP_TOKEN_BUDGET = Math.floor(MAX_CONTEXT_TOKENS * 0.05);
      const toKeep: MastraDBMessage[] = [];
      let keepTokens = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msgTokens = calcMessagesTokens([messages[i]]);
        // 还没放进任何消息时,即使单条超预算也要收下最后一条(否则语义上没有"最近消息"了)
        if (toKeep.length > 0 && keepTokens + msgTokens > KEEP_TOKEN_BUDGET) break;
        toKeep.unshift(messages[i]);
        keepTokens += msgTokens;
      }
      const toSummarize = messages.slice(0, messages.length - toKeep.length);

      // 全部消息都进了保留集合(总量本来就低于预算):没有可压缩的内容
      if (toSummarize.length === 0) {
        return c.json({ ok: false, reason: '消息体量较小,无需压缩' }, 400);
      }

      // 把待压缩的消息序列化成文本,让模型生成一段简洁摘要
      const conversation = toSummarize
        .map(m => {
          const text = extractText(m.content);
          const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
          return `${role}: ${text.slice(0, 500)}`;
        })
        .join('\n');

      let summary: string;
      try {
        const result = await agent.generate(
          `请把以下对话历史压缩成一段简洁的摘要（保留关键结论、任务状态和重要细节），不超过 300 字。只输出摘要内容：\n\n${conversation}`,
          { maxSteps: 1 },
        );
        summary = result.text?.trim() ?? '';
      } catch {
        return c.json({ ok: false, reason: '摘要生成失败' }, 500);
      }

      if (!summary) return c.json({ ok: false, reason: '摘要为空' }, 500);

      const tokensBefore = calcMessagesTokens(messages);

      // 先把摘要作为一条 assistant 消息写回线程;写回成功后再删除旧消息,避免写入失败导致数据永久丢失
      const summaryMessage: MastraDBMessage = {
        id: crypto.randomUUID(),
        threadId,
        resourceId: RESOURCE_ID,
        role: 'assistant',
        createdAt: new Date(),
        content: {
          format: 2,
          parts: [{ type: 'text', text: `【历史摘要】${summary}` }],
        },
      };

      try {
        await memory.saveMessages({ messages: [summaryMessage] });
      } catch {
        return c.json({ ok: false, reason: '摘要写回失败' }, 500);
      }

      // 摘要写回成功后,再删除被摘要的旧消息
      const deleteIds = toSummarize.map(m => m.id);
      try {
        await memory.deleteMessages(deleteIds);
      } catch {
        return c.json({ ok: false, reason: '消息删除失败' }, 500);
      }

      const tokensAfter = calcMessagesTokens([summaryMessage, ...toKeep]);

      return c.json({
        ok: true,
        summary,
        deletedCount: deleteIds.length,
        tokensBefore,
        tokensAfter,
      });
    },
  }),
];
