import { AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { API_BASE } from './apiBase';
import { formatSize, type PickedAttachment } from './driveClient';


// 所有任务属于同一个本地资源(plan:任务 = thread,resource 固定)
export const LOCAL_USER_RESOURCE = 'local-user';

// 附件段落的标记格式(渲染层据此把段落显示为可下载的文档卡片)
// 格式:【附件:文件名(大小)#网盘文件id】
export function attachmentSection(attachments: PickedAttachment[]): string {
  return attachments
    .map(a => `【附件:${a.name}(${formatSize(a.size)})#${a.id}】\n${a.text}`)
    .join('\n\n');
}

// 一个任务 = 一个 thread:transport 负责在请求体带上 memory 参数
// (Mastra agent.stream 的形状为 memory: { thread, resource },
// chatRoute 把 body 多余字段透传给 agent.stream,见 plan 模块交互)
// M7/H0:getRequestContext 返回的内容随请求携带(requestContext.model/projectDir/…),
// 驱动动态模型与项目工具
export function createTaskTransport(
  threadId: string,
  getRequestContext?: () => Record<string, unknown> | undefined,
) {
  return new AssistantChatTransport({
    api: `${API_BASE}/chat/agent`,
    prepareSendMessagesRequest: ({ messages }) => {
      const requestContext = getRequestContext?.();
      return {
        body: {
          messages,
          memory: { thread: threadId, resource: LOCAL_USER_RESOURCE },
          ...(requestContext ? { requestContext } : {}),
        },
      };
    },
  });
}

// 新任务 id(即新 threadId)
export function newTaskId(): string {
  return crypto.randomUUID();
}
