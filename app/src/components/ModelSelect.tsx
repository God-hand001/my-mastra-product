import { useState } from 'react';
import { CHAT_MODELS, modelLabel } from '../lib/models';

// 模型选择器(M7:对话栏/首页共用,发送按钮旁下拉切换)
export function ModelSelect({
  model,
  onModelChange,
}: {
  model: string;
  onModelChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="model-select">
      <button
        type="button"
        className="model-select-btn"
        title="切换模型"
        onClick={() => setOpen(o => !o)}
      >
        {modelLabel(model)}
        <span className="model-select-chev">▾</span>
      </button>
      {open && (
        <>
          <div className="model-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="model-menu">
            {CHAT_MODELS.map(m => (
              <button
                key={m.id}
                type="button"
                className={`model-menu-item${model === m.id ? ' is-active' : ''}`}
                onClick={() => {
                  onModelChange(m.id);
                  setOpen(false);
                }}
              >
                <span className="model-menu-label">
                  {m.label}
                  {model === m.id && <span className="model-menu-check"> ✓</span>}
                </span>
                <span className="model-menu-desc">{m.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
