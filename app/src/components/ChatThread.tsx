import { useState, type KeyboardEvent } from 'react';
import { API_BASE } from '../lib/apiBase';
import {
  AssistantRuntime,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallCard } from './ToolCallCard';
import { AttachmentBar } from './AttachmentBar';
import { attachmentSection } from '../lib/transport';
import { ModelSelect } from './ModelSelect';
import type { PickedAttachment } from '../lib/driveClient';

// Markdown 渲染(F5):remark-gfm 提供表格/删除线等扩展语法支持
const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-markdown" />
);

// 附件段落渲染为独立的可下载文档卡片
// 标记格式:【附件:文件名(大小)#网盘id】;标记后的附件全文不显示在气泡里
function UserText({ text }: TextMessagePartProps) {
  const first = /【附件:(.+?)(?:[（(]([^）)]+)[）)])?(?:#([0-9a-f-]{36}))?】/.exec(text);
  if (!first) {
    // 普通用户消息:无附件标记,整段进气泡
    return <div className="msg-user-text">{text}</div>;
  }
  // 有附件标记:气泡只保留标记之前的用户原文,标记后的附件全文隐藏
  const before = text.slice(0, first.index).trim();
  const cards: { name: string; size?: string; id?: string }[] = [];
  const re = /【附件:(.+?)(?:[（(]([^）)]+)[）)])?(?:#([0-9a-f-]{36}))?】/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    cards.push({ name: m[1], size: m[2], id: m[3] });
  }
  return (
    <>
      {before && <div className="msg-user-text">{before}</div>}
      {cards.map((c, i) => {
        const ext = (c.name.split('.').pop() ?? '').toLowerCase();
        const badge = ext === 'docx' ? 'W' : ext === 'xlsx' ? 'X' : ext === 'pdf' ? 'P' : '📄';
        const inner = (
          <>
            <span className={`msg-file-icon file-${ext || 'default'}`}>{badge}</span>
            <div className="msg-file-info">
              <div className="msg-file-name">{c.name}</div>
              <div className="msg-file-size">
                {ext.toUpperCase()}
                {c.size ? ` · ${c.size}` : ''}
              </div>
            </div>
          </>
        );
        return c.id ? (
          <a
            key={i}
            className="msg-file-card"
            href={`${API_BASE}/drive/files/${c.id}/download`}
            download={c.name}
            title="点击下载"
          >
            {inner}
          </a>
        ) : (
          <div key={i} className="msg-file-card">
            {inner}
          </div>
        );
      })}
    </>
  );
}

function UserMessage() {
  return (
    <div className="msg msg-user">
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </div>
  );
}

function ChatMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.If user>
        <UserMessage />
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <AssistantMessage />
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <div className="msg msg-assistant">
      <MessagePrimitive.Parts
        components={{
          Text: MarkdownText,
          tools: { Fallback: ToolCallCard },
        }}
      />
    </div>
  );
}

// 任务对话主视图(assistant-ui primitives 自建)
// M2:附件在发送时拼进消息本体(实时即显卡片),发送/回车走同一逻辑
// M7:发送按钮旁模型选择器(下拉切换,requestContext.model 随请求携带)
export function ChatThread({
  runtime,
  attachments,
  model,
  onModelChange,
  onOpenPicker,
  onRemoveAttachment,
  onAttachmentsConsumed,
}: {
  runtime: AssistantRuntime;
  attachments: PickedAttachment[];
  model: string;
  onModelChange: (id: string) => void;
  onOpenPicker: () => void;
  onRemoveAttachment: (id: string) => void;
  onAttachmentsConsumed: () => void;
}) {
  const [input, setInput] = useState('');
  const composer = runtime.thread.composer;

  const handleSend = () => {
    if (runtime.thread.getState().isRunning) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const section = attachments.length > 0 ? `\n\n${attachmentSection(attachments)}` : '';
    composer.setText(text + section);
    composer.send();
    composer.setText('');
    setInput('');
    if (attachments.length > 0) onAttachmentsConsumed();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <ThreadPrimitive.Root className="chat-root">
      <ThreadPrimitive.Viewport autoScroll className="chat-viewport">
        <ThreadPrimitive.If empty>
          <div className="chat-welcome">这是你的任务空间,描述一个任务开始吧</div>
        </ThreadPrimitive.If>
        <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
      </ThreadPrimitive.Viewport>

      <div className="chat-composer-area">
        <div className="chat-composer">
          {attachments.length > 0 && (
            <AttachmentBar attachments={attachments} onRemove={onRemoveAttachment} />
          )}
          <div className="chat-composer-row">
            <button type="button" className="task-input-plus" title="添加附件" onClick={onOpenPicker}>
              +
            </button>
            <textarea
              className="chat-composer-input"
              placeholder="继续追问或补充任务要求…"
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="chat-composer-actions">
            <ModelSelect model={model} onModelChange={onModelChange} />
            {/* 运行中显示"停止",空闲显示"发送" */}
            <ThreadPrimitive.If running>
              <button type="button" className="chat-btn chat-btn-cancel" onClick={() => composer.cancel()}>
                停止
              </button>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <button
                type="button"
                className="chat-btn chat-btn-send"
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
              >
                发送
              </button>
            </ThreadPrimitive.If>
          </div>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}
