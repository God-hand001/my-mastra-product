import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TaskInput } from '../components/TaskInput';
import type { Attachment } from '../components/AttachmentBar';
import { useTaskStore } from '../lib/taskStore';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomePage() {
  const navigate = useNavigate();
  const { createTask } = useTaskStore();
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleSubmit = (text: string, list: Attachment[]) => {
    // M2 F2:附件全文已在上传/选择时由后端提取,这里拼装进首条消息
    // (前端中转全文方案,见 plan 模块交互)
    const attachmentSections = list
      .map(a => `【附件:${a.name}】\n${a.text}`)
      .join('\n\n');
    const firstMessage = attachmentSections
      ? `${text.trim()}${text.trim() ? '\n\n' : ''}${attachmentSections}`
      : text.trim();

    const id = createTask(firstMessage);
    navigate(`/task/${id}`, { state: { initialMessage: firstMessage } });
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        <h1 className="home-greeting">
          {greeting()},god
          <br />
          准备好创建点什么了吗?
        </h1>
        <TaskInput
          onSubmit={handleSubmit}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      </div>
    </div>
  );
}
