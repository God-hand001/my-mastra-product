import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/apiBase';
import { useLocation, useParams } from 'react-router-dom';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import type { UIMessage } from 'ai';
import { attachmentSection, createTaskTransport, LOCAL_USER_RESOURCE } from '../lib/transport';
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
    let timer: ReturnType<typeof setInterval> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;

    // 后台定时任务通过 Mastra signal 唤醒线程时，结果会先进入线程 stream。
    // 订阅该 stream 后再刷新 memory，页面才能在任务对话中自动显示 assistant 回复。
    const refreshSoon = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void loadMessages(false);
      }, 300);
    };

    const loadMessages = async (showLoading: boolean) => {
      if (showLoading) setBoot(null);
      try {
        // 线程同时按 agentId 和 resourceId 区分；定时任务使用 local-user，
        // 缺少 resourceId 时接口会返回空消息，导致已执行的结果在页面不可见。
        const res = await fetch(
          `${API_BASE}/api/memory/threads/${id}/messages?agentId=${AGENT_ID}&resourceId=${encodeURIComponent(LOCAL_USER_RESOURCE)}&page=0&perPage=100`,
        );
        if (!res.ok) throw new Error(`加载历史失败: ${res.status}`);
        const data = (await res.json()) as { messages?: MastraMessage[] };
        if (alive) setBoot({ messages: toUIMessages(data.messages ?? []) });
      } catch (err) {
        // 后端未启动或线程尚未创建:退化为空历史,不白屏
        console.error('加载任务历史失败', err);
        if (alive) setBoot({ messages: [] });
      }
    };

    void loadMessages(true);
    // 定时任务在后台执行，页面没有对应的流式请求；轮询让结果像办公助手一样自动出现。
    timer = setInterval(() => void loadMessages(false), 3_000);

    // subscribe 接口是长连接：空闲时保持连接，定时 signal 到达后会推送事件。
    // 即使某次连接被开发服务器/代理断开，也自动重连，避免必须手动刷新页面。
    const subscribe = async () => {
      while (alive) {
        const controller = new AbortController();
        activeController = controller;
        try {
          const response = await fetch(`${API_BASE}/api/agents/${AGENT_ID}/threads/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ threadId: id, resourceId: LOCAL_USER_RESOURCE }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`线程订阅失败: ${response.status}`);
          if (!response.body) throw new Error('线程订阅未返回可读流');

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (alive) {
            const { value, done } = await reader.read();
            if (done) break;
            // 不依赖具体事件类型；收到任意非心跳数据都触发一次历史刷新。
            const chunk = decoder.decode(value, { stream: true });
            if (chunk.replace(/:\s*keep-alive\s*/g, '').trim()) refreshSoon();
          }
          reader.releaseLock();
        } catch (err) {
          if (alive) console.error('线程订阅失败', err);
        } finally {
          controller.abort();
          if (activeController === controller) activeController = undefined;
        }
        if (alive) await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    };
    void subscribe();

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (refreshTimer) clearTimeout(refreshTimer);
      activeController?.abort();
    };
  }, [id]);

  if (boot === null) {
    return <div className="task-loading">加载任务中…</div>;
  }

  const initialAttachments =
    (location.state as { attachments?: PickedAttachment[] } | null)?.attachments ?? [];

  return (
    <TaskChat
      // 定时执行会异步写入消息；数量变化时重建 runtime，显示最新 assistant 回复。
      // 后台执行完成后会新增 assistant 消息，数量变化时重建 runtime 以载入最新历史。
      // 不把内容长度放进 key，避免用户正在编辑输入框时被流式更新重置草稿。
      key={`${id}:${boot.messages.length}`}
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
