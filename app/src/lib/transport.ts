import { AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { formatSize, type PickedAttachment } from './driveClient';

// 所有任务属于同一个本地资源(plan:任务 = thread,resource 固定)
export const LOCAL_USER_RESOURCE = 'local-user';

// 附件段落的标记格式(渲染层据此把段落显示为文档卡片)
export function attachmentSection(attachments: PickedAttachment[]): string {
  return attachments.map(a => `【附件:${a.name}(${formatSize(a.size)})】\n${a.text}`).join('\n\n');
}

// 一个任务 = 一个 thread:transport 负责在请求体带上 memory 参数
// (Mastra agent.stream 的形状为 memory: { thread, resource },
// chatRoute 把 body 多余字段透传给 agent.stream,见 plan 模块交互)
// M2:getAttachments 非空时,发送前把附件全文合并进最后一条用户消息
export function createTaskTransport(
  threadId: string,
  getAttachments?: () => PickedAttachment[],
  onAttachmentsConsumed?: () => void,
) {
  return new AssistantChatTransport({
    api: '/chat/agent',
    prepareSendMessagesRequest: ({ messages }) => {
      const attachments = getAttachments?.() ?? [];
      let bodyMessages = messages;
      if (attachments.length > 0) {
        const section = attachmentSection(attachments);
        bodyMessages = messages.map((m, i) => {
          if (i !== messages.length - 1 || m.role !== 'user') return m;
          return { ...m, parts: [...m.parts, { type: 'text' as const, text: `\n\n${section}` }] };
        });
        onAttachmentsConsumed?.();
      }
      return {
        body: {
          messages: bodyMessages,
          memory: { thread: threadId, resource: LOCAL_USER_RESOURCE },
        },
      };
    },
  });
}

// 新任务 id(即新 threadId)
export function newTaskId(): string {
  return crypto.randomUUID();
}
