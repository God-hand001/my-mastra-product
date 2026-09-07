import { useState, type KeyboardEvent } from 'react';
import { AttachmentBar, type Attachment } from './AttachmentBar';
import { AttachmentPicker } from './AttachmentPicker';

// 首页的大任务输入框(千问办公样式:居中、大圆角、回车提交)
// M2:"+"支持附件(上传新文件 / 从网盘选择),最多 5 个
export function TaskInput({
  onSubmit,
  attachments,
  onAttachmentsChange,
}: {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  attachments: Attachment[];
  onAttachmentsChange: (list: Attachment[]) => void;
}) {
  const [value, setValue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const remaining = 5 - attachments.length;

  const submit = () => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    onSubmit(text, attachments);
    setValue('');
    onAttachmentsChange([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handlePick = (a: Attachment): boolean => {
    if (remaining <= 0) return false;
    // 同一网盘文件不重复附加
    if (attachments.some(x => x.id === a.id)) return true;
    onAttachmentsChange([...attachments, a]);
    return true;
  };

  return (
    <div className="task-input-box">
      <AttachmentBar
        attachments={attachments}
        onRemove={id => onAttachmentsChange(attachments.filter(a => a.id !== id))}
      />
      <textarea
        className="task-input-textarea"
        placeholder="描述一个任务,例如:把我的营销数据转化为清晰的可视化图表"
        rows={3}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <div className="task-input-footer">
        <div className="task-input-left">
          <button className="task-input-plus" title="添加附件" onClick={() => setPickerOpen(true)}>
            +
          </button>
          <span className="task-input-hint">Enter 发送,Shift+Enter 换行</span>
        </div>
        <button className="task-input-send" onClick={submit} disabled={!value.trim() && attachments.length === 0}>
          开始任务
        </button>
      </div>
      {pickerOpen && (
        <AttachmentPicker
          onClose={() => setPickerOpen(false)}
          onPick={handlePick}
        />
      )}
    </div>
  );
}
