import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { Thread, ThreadConfigProvider } from '@assistant-ui/react-ui';
import type { UIMessage } from 'ai';
import { createTaskTransport } from '../lib/transport';
import { toUIMessages, type MastraMessage } from '../lib/messages';
import { ToolCallCard } from '../components/ToolCallCard';

const AGENT_ID = 'agent';

// 任务视图:一个任务 = 一个 thread,进页先拉历史(F4),
// 新任务把创建时输入的内容作为首条消息自动发出(F2)
export function TaskPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const initialMessage = (location.state as { initialMessage?: string } | null)?.initialMessage;

  const [bootMessages, setBootMessages] = useState<UIMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    setBootMessages(null);
    (async () => {
      try {
        const res = await fetch(`/api/memory/threads/${id}/messages?agentId=${AGENT_ID}`);
        if (!res.ok) throw new Error(`加载历史失败: ${res.status}`);
        const data = (await res.json()) as { messages?: MastraMessage[] };
        if (alive) setBootMessages(toUIMessages(data.messages ?? []));
      } catch (err) {
        // 后端未启动或线程尚未创建:退化为空历史,不白屏
        console.error('加载任务历史失败', err);
        if (alive) setBootMessages([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const runtime = useChatRuntime({
    transport: createTaskTransport(id),
    id,
    messages: bootMessages ?? [],
  });

  // 首条消息:仅当任务为空且创建时带了输入内容时自动发出
  const sentForRef = useRef<string | null>(null);
  useEffect(() => {
    if (bootMessages === null) return;
    if (!initialMessage || bootMessages.length > 0) return;
    if (sentForRef.current === id) return;
    sentForRef.current = id;
    runtime.thread.append(initialMessage);
  }, [runtime, initialMessage, bootMessages, id]);

  if (bootMessages === null) {
    return <div className="task-loading">加载任务中…</div>;
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadConfigProvider
        config={{
          assistantMessage: { components: { ToolFallback: ToolCallCard } },
          welcome: { message: '这是你的任务空间,描述一个任务开始吧' },
          strings: {
            composer: {
              input: { placeholder: '继续追问或补充任务要求…' },
              send: { tooltip: '发送' },
              cancel: { tooltip: '停止' },
            },
            assistantMessage: {
              reload: { tooltip: '重新生成' },
              copy: { tooltip: '复制' },
            },
            userMessage: { edit: { tooltip: '编辑' } },
            thread: { scrollToBottom: { tooltip: '回到底部' } },
          },
        }}
      >
        <div className="task-thread-wrap">
          <Thread />
        </div>
      </ThreadConfigProvider>
    </AssistantRuntimeProvider>
  );
}
