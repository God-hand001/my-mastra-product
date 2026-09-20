import type { UIMessage } from 'ai';

// 把 Mastra 记忆格式消息转为 AI SDK UIMessage(历史回看,F4)
// Mastra: { id, role, content: { format, parts: [...] } }
// UIMessage: { id, role, parts: [{ type: 'text', text }, ...] }

interface MastraPart {
  type: string;
  text?: string;
  reasoning?: string;
  // 工具调用(历史存储为 tool-invocation 嵌套形态,经服务端实测确认)
  toolInvocation?: {
    state?: string;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    result?: unknown;
  };
}

export interface MastraMessage {
  id: string;
  role: string;
  content?: { format?: number; parts?: MastraPart[] } | string;
  createdAt?: string;
  /** signal 消息的子类型;agent 待办工具会写 current-task-list / task-list-update */
  type?: string;
}

// agent 的待办工具以 role=signal 写入内部进度(实测 type 为 current-task-list、
// task-list-update),内容形如"✓ [completed] {id: t1} ...",属于内部状态而非对话内容,
// 直接渲染会在气泡里冒出原始待办文本。这里按 type 排除,而不是只放行已知类型 ——
// 定时任务的 signal 具体 type 未知,用白名单会误伤它。
function isInternalTaskListSignal(m: MastraMessage): boolean {
  return m.role === 'signal' && (m.type ?? '').includes('task-list');
}

export function toUIMessages(list: MastraMessage[]): UIMessage[] {
  return list
    // 定时任务触发后，Mastra 会先写入 role=signal；将其作为用户消息展示，
    // 这样即使模型仍在后台执行，对话框也不会保持空白。
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'signal')
    .filter(m => !isInternalTaskListSignal(m))
    .map(m => {
      const parts =
        typeof m.content === 'string'
          ? ([{ type: 'text', text: m.content }] as MastraPart[])
          : (m.content?.parts ?? []);

      const uiParts: UIMessage['parts'] = [];
      for (const p of parts) {
        if (p.type === 'text' && p.text) {
          uiParts.push({ type: 'text', text: p.text });
        } else if (p.type === 'reasoning' && (p.text || p.reasoning)) {
          uiParts.push({ type: 'reasoning', text: p.text ?? p.reasoning ?? '' });
        } else if (p.type === 'tool-invocation' && p.toolInvocation?.toolName) {
          // 以 dynamic-tool 形态回放工具调用,供界面展示执行过程
          const t = p.toolInvocation;
          const isResult = t.state === 'result';
          uiParts.push({
            type: 'dynamic-tool',
            toolName: t.toolName,
            toolCallId: t.toolCallId ?? '',
            state: isResult ? 'output-available' : 'input-available',
            input: (t.args ?? {}) as Record<string, unknown>,
            ...(isResult ? { output: t.result as unknown } : {}),
          } as UIMessage['parts'][number]);
        }
      }

      return {
        id: m.id,
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        parts: uiParts,
        // 透传 Mastra 的真实发送时间;否则 @assistant-ui/ai-sdk 的转换器会用
        // `new Date()`(转换时刻)当作 createdAt,刷新页面后所有历史消息都显示"刚刚"。
        // AssistantChatTransport 之后按非保留键收进 metadata.custom,
        // ChatThread.tsx 的 MessageTimestamp 读 metadata.custom.createdAt。
        ...(m.createdAt ? { metadata: { createdAt: m.createdAt } } : {}),
      } as UIMessage;
    })
    .filter(m => m.parts.length > 0);
}
