import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolCallCard } from './ToolCallCard';

// Markdown 渲染(F5):remark-gfm 提供表格/删除线等扩展语法支持
const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-markdown" />
);

function UserMessage() {
  return (
    <div className="msg msg-user">
      <MessagePrimitive.Parts components={{ Text: ({ text }: TextMessagePartProps) => <div className="msg-user-text">{text}</div> }} />
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
export function ChatThread() {
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
          <ComposerPrimitive.Input
            className="chat-composer-input"
            placeholder="继续追问或补充任务要求…"
            autoFocus
            rows={1}
          />
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
