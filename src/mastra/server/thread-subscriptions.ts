import type { Agent } from '@mastra/core/agent';

type Subscription = {
  unsubscribe?: () => void;
};

// 进程内为每个定时任务线程保留一个消费者。
// Mastra 的 threaded schedule 只有在线程有订阅者时，wake stream 才会被驱动；
// 这里由服务端消费并持久化 stream，保证用户不打开网页时任务也能执行。
const subscriptions = new Map<string, Subscription>();

export async function ensureThreadSubscription(
  agent: Agent,
  threadId: string,
  resourceId: string,
): Promise<void> {
  const key = `${resourceId}:${threadId}`;
  if (subscriptions.has(key)) return;

  const subscription = await agent.subscribeToThread({ threadId, resourceId });
  subscriptions.set(key, subscription);

  void (async () => {
    try {
      for await (const _chunk of subscription.stream) {
        // 仅消费 stream 即可让 Mastra 完成运行并写入 memory；前端会读取持久化消息。
      }
    } catch (error) {
      console.error(`定时任务线程订阅中断 (${threadId})`, error);
    } finally {
      subscriptions.delete(key);
    }
  })();
}

