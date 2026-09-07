import { AssistantChatTransport } from '@assistant-ui/react-ai-sdk';

// 所有任务属于同一个本地资源(plan:任务 = thread,resource 固定)
export const LOCAL_USER_RESOURCE = 'local-user';

// 一个任务 = 一个 thread:transport 负责在请求体带上 memory 参数
// (Mastra agent.stream 的形状为 memory: { thread, resource },
// chatRoute 把 body 多余字段透传给 agent.stream,见 plan 模块交互)
export function createTaskTransport(threadId: string) {
  return new AssistantChatTransport({
    api: '/chat/agent',
    prepareSendMessagesRequest: ({ messages }) => ({
      body: {
        messages,
        memory: { thread: threadId, resource: LOCAL_USER_RESOURCE },
      },
    }),
  });
}

// 新任务 id(即新 threadId)
export function newTaskId(): string {
  return crypto.randomUUID();
}
