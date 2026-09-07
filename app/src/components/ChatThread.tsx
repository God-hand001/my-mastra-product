import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallCard } from './ToolCallCard';
import { AttachmentBar } from './AttachmentBar';
import type { PickedAttachment } from '../lib/driveClient';

// Markdown 渲染(F5):remark-gfm 提供表格/删除线等扩展语法支持
const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-markdown" />
);

// 附件段落(由 transport 合并进消息)渲染为独立的可下载文档卡片
// 标记格式:【附件:文件名(大小)#网盘id】;标记后的附件全文不显示在气泡里
function UserText({ text }: TextMessagePartProps) {
  const re = /【附件:(.+?)(?:（([^）]+)）)?(?:#([0-9a-f-]{36}))?】/g;
  const cards: { name: string; size?: string; id?: string }[] = [];
  let head = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    head += text.slice(last, m.index);
    last = re.lastIndex;
    cards.push({ name: m[1], size: m[2], id: m[3] });
  }

  const trimmed = head.trim();
  return (
    <>
      {trimmed && <div className="msg-user-text">{trimmed}</div>}
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
            href={`/drive/files/${c.id}/download`}
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

// 任务对话主视图(assistant-ui primitives 自建,替代停更的 react-ui 预置包)
// M2:composer 支持"+"附件与附件条(发送时由 transport 合并进消息)
export function ChatThread({
  attachments,
  onOpenPicker,
  onRemoveAttachment,
}: {
  attachments: PickedAttachment[];
  onOpenPicker: () => void;
  onRemoveAttachment: (id: string) => void;
}) {
  return (
    <ThreadPrimitive.Root className="chat-root">
      <ThreadPrimitive.Viewport autoScroll className="chat-viewport">
        <ThreadPrimitive.If empty>
          <div className="chat-welcome">这是你的任务空间,描述一个任务开始吧</div>
        </ThreadPrimitive.If>
        <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
      </ThreadPrimitive.Viewport>

      <div className="chat-composer-area">
        <ComposerPrimitive.Root className="chat-composer">
          {attachments.length > 0 && (
            <AttachmentBar
              attachments={attachments}
              onRemove={onRemoveAttachment}
            />
          )}
          <div className="chat-composer-row">
            <button
              type="button"
              className="task-input-plus"
              title="添加附件"
              onClick={onOpenPicker}
            >
              +
            </button>
            <ComposerPrimitive.Input
              className="chat-composer-input"
              placeholder="继续追问或补充任务要求…"
              rows={1}
            />
          </div>
          <div className="chat-composer-actions">
            {/* 运行中显示"停止",空闲显示"发送" */}
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel className="chat-btn chat-btn-cancel">
                停止
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send className="chat-btn chat-btn-send">
                发送
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
