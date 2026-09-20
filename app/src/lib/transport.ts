import { AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { API_BASE } from './apiBase';
import { formatSize, type PickedAttachment } from './driveClient';
import { loadPermission } from '../components/PermissionSelect';
import { useWorkbenchStore } from './workbenchStore';


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
// 注意:不覆写 prepareSendMessagesRequest,保留 AI SDK 原生 reload 流程
// (覆写会破坏 trigger/messageId 传递,导致重新生成变成追加而非替换)
export function createTaskTransport(
  threadId: string,
  getRequestContext?: () => Record<string, unknown> | undefined,
) {
  return new AssistantChatTransport({
    api: `${API_BASE}/chat/agent`,
    body: () => {
      const requestContext = getRequestContext?.();
      return {
        memory: { thread: threadId, resource: LOCAL_USER_RESOURCE },
        // 档位随 requestContext 携带(后端 resolveTier 读 requestContext.permission);
        // 每条消息重新读 localStorage,切换档位即时生效
        requestContext: { ...(requestContext ?? {}), permission: loadPermission(), role: useWorkbenchStore.getState().roleOf(threadId) },
      };
    },
  });
}

// 新任务 id(即新 threadId)
export function newTaskId(): string {
  return crypto.randomUUID();
}
