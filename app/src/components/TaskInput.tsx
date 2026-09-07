import { useState, type KeyboardEvent } from 'react';

// 首页的大任务输入框(千问办公样式:居中、大圆角、回车提交)
export function TaskInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="task-input-box">
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
        <span className="task-input-hint">Enter 发送,Shift+Enter 换行</span>
        <button
          className="task-input-send"
          onClick={submit}
          disabled={!value.trim()}
        >
          开始任务
        </button>
      </div>
    </div>
  );
}
