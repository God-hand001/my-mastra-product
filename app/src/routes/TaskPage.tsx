import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { createTaskTransport } from '../lib/transport';
import { toUIMessages, type MastraMessage } from '../lib/messages';
import { ChatThread } from '../components/ChatThread';

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

  return (
    <TaskChat
      key={id}
      taskId={id}
      history={boot.messages}
      pendingFirstMessage={initialMessage}
    />
  );
}

// 内层组件:runtime 必须在历史就绪后挂载(useChat 的 messages 选项只在创建时生效)
function TaskChat({
  taskId,
  history,
  pendingFirstMessage,
}: {
  taskId: string;
  history: UIMessage[];
  pendingFirstMessage?: string;
}) {
  const runtime = useChatRuntime({
    transport: createTaskTransport(taskId),
    id: taskId,
    messages: history,
  });

  // 首条消息:仅当任务为空且创建时带了输入内容时自动发出(F2)
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (!pendingFirstMessage || history.length > 0) return;
    sentRef.current = true;
    runtime.thread.append(pendingFirstMessage);
  }, [runtime, pendingFirstMessage, history.length]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="task-thread-wrap">
        <ChatThread />
      </div>
    </AssistantRuntimeProvider>
  );
}
