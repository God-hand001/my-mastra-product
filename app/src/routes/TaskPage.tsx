import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { attachmentSection, createTaskTransport } from '../lib/transport';
import { toUIMessages, type MastraMessage } from '../lib/messages';
import { ChatThread } from '../components/ChatThread';
import { AttachmentPicker } from '../components/AttachmentPicker';
import type { PickedAttachment } from '../lib/driveClient';

const AGENT_ID = 'agent';

// 任务视图外壳:先拉历史,就绪后才挂载聊天(保证 runtime 以完整历史初始化,F4)
export function TaskPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage;

  const [boot, setBoot] = useState<{ messages: UIMessage[] } | null>(null);

  useEffect(() => {
    let alive = true;
    setBoot(null);
    (async () => {
      try {
        const res = await fetch(`/api/memory/threads/${id}/messages?agentId=${AGENT_ID}`);
        if (!res.ok) throw new Error(`加载历史失败: ${res.status}`);
        const data = (await res.json()) as { messages?: MastraMessage[] };
        if (alive) setBoot({ messages: toUIMessages(data.messages ?? []) });
      } catch (err) {
        // 后端未启动或线程尚未创建:退化为空历史,不白屏
        console.error('加载任务历史失败', err);
        if (alive) setBoot({ messages: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (boot === null) {
    return <div className="task-loading">加载任务中…</div>;
  }

  const initialAttachments =
    (location.state as { attachments?: PickedAttachment[] } | null)?.attachments ?? [];

  return (
    <TaskChat
      key={id}
      taskId={id}
      history={boot.messages}
      pendingFirstMessage={initialMessage}
      initialAttachments={initialAttachments}
    />
  );
}

// 内层组件:runtime 必须在历史就绪后挂载(useChat 的 messages 选项只在创建时生效)
function TaskChat({
  taskId,
  history,
  pendingFirstMessage,
  initialAttachments,
}: {
  taskId: string;
  history: UIMessage[];
  pendingFirstMessage?: string;
  initialAttachments?: PickedAttachment[];
}) {
  // M2:任务内附件 —— 发送时拼进消息本体(实时即显卡片),发送后清空
  // initialAttachments:首页创建任务时带过来的附件(随首条消息注入)
  const [attachments, setAttachments] = useState<PickedAttachment[]>(initialAttachments ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const runtime = useChatRuntime({
    transport: createTaskTransport(taskId),
    id: taskId,
    messages: history,
  });

  // 首条消息:仅当任务为空且创建时带了输入内容时自动发出(F2)
  // 附件全文随首条消息一起注入(实时即显卡片)
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (!pendingFirstMessage && (initialAttachments?.length ?? 0) === 0) return;
    if (history.length > 0) return;
    sentRef.current = true;
    const section =
      initialAttachments && initialAttachments.length > 0
        ? `\n\n${attachmentSection(initialAttachments)}`
        : '';
    runtime.thread.append((pendingFirstMessage ?? '') + section);
    setAttachments([]);
  }, [runtime, pendingFirstMessage, initialAttachments, history.length]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="task-thread-wrap">
        <ChatThread
          runtime={runtime}
          attachments={attachments}
          onOpenPicker={() => setPickerOpen(true)}
          onRemoveAttachment={id => setAttachments(prev => prev.filter(a => a.id !== id))}
          onAttachmentsConsumed={() => setAttachments([])}
        />
      </div>
      {pickerOpen && (
        <AttachmentPicker
          onClose={() => setPickerOpen(false)}
          onPick={a => {
            if (attachments.some(x => x.id === a.id)) return true;
            if (attachments.length >= 5) return false;
            setAttachments(prev => [...prev, a]);
            return true;
          }}
        />
      )}
    </AssistantRuntimeProvider>
  );
}
