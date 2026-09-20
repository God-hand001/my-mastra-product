import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';

// 任务摘要路由(H0:右侧预览面板)
// 与 context-routes 的 compress 不同:这里不删除任何消息,纯只读生成摘要。

const AGENT_ID = 'agent';
const RESOURCE_ID = 'local-user';

// 摘要缓存:线程内消息未变化时,右侧面板反复打开不用重复调用模型。
type SummaryCache = {
  messageCount: number;
  lastMessageId: string;
  summary: string;
};

const summaryCaches = new Map<string, SummaryCache>();

// 递归提取消息中的全部文本(与 context-routes 的 extractText 保持同一模式)
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

// 读取线程全部消息;空线程和读取失败都按无消息处理,不产生摘要。
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

export const summaryRoutes = [
  registerApiRoute('/threads/:threadId/summary', {
    method: 'GET',
    handler: async c => {
      const mastra = c.get('mastra');
      const threadId = c.req.param('threadId');
      const messages = await getThreadMessages(mastra, threadId);
      if (!messages || messages.length === 0) {
        return c.json({ summary: '' });
      }

      const lastMessageId = messages[messages.length - 1]?.id ?? '';
      const cached = summaryCaches.get(threadId);
      if (cached && cached.messageCount === messages.length && cached.lastMessageId === lastMessageId) {
        return c.json({ summary: cached.summary });
      }

      // 序列化对话时每条截断到 500 字,避免长任务把摘要请求撑得过大。
      const conversation = messages
        .map(message => {
          const role =
            message.role === 'user' ? '用户' : message.role === 'assistant' ? '助手' : message.role;
          return `${role}: ${extractText(message.content).slice(0, 500)}`;
        })
        .join('\n');

      const agent = await mastra.getAgent(AGENT_ID);
      try {
        const result = await agent.generate(
          `请把以下任务对话总结成一份任务摘要,包含:任务目标、已完成的关键结论、产出物清单、后续待办。不超过 400 字。只输出摘要内容：\n\n${conversation}`,
          { maxSteps: 1 },
        );
        const summary = result.text?.trim() ?? '';
        summaryCaches.set(threadId, { messageCount: messages.length, lastMessageId, summary });
        return c.json({ summary });
      } catch {
        return c.json({ error: '摘要生成失败' }, 500);
      }
    },
  }),
];
