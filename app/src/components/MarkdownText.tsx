import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Markdown 渲染(F5):remark-gfm 提供表格/删除线等扩展语法支持
// 单独成文件:ChatThread 与 AssistantSteps 都要用它渲染文本 part,
// 若留在 ChatThread 里会与 AssistantSteps 形成循环 import
export const MarkdownText = ({ text }: { text?: string }) => {
  if (text !== undefined) {
    return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
  }
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-markdown" />;
};
