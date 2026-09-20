import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  allSelectableModels,
  fetchCustomModels,
  modelDisplayParts,
  onCustomModelsChanged,
} from '../lib/models';

// 模型选择器(对话栏/首页共用,发送按钮旁下拉切换)
// 显示格式: "层级 | 模型名"，如 "标准 | deepseek-v4-flash"
// M17:菜单合并"我的模型"页配置的自定义模型,底部提供管理入口。
function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function ModelSelect({
  model,
  onModelChange,
  compact = false,
}: {
  model: string;
  onModelChange: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // 自定义模型联动:挂载时拉取一次;"我的模型"页增删改后经事件刷新
  const [, setCustomVersion] = useState(0);
  useEffect(() => {
    void fetchCustomModels();
    return onCustomModelsChanged(() => setCustomVersion(v => v + 1));
  }, []);

  const models = allSelectableModels();
  const display = modelDisplayParts(model);

  return (
    <div className={`model-select${compact ? ' is-compact' : ''}`}>
      <button
        type="button"
        className="model-select-btn"
        title={compact ? `${display.label} | ${display.detail}` : '切换模型'}
        onClick={() => setOpen(o => !o)}
      >
        {compact ? <ChevronRightIcon /> : `${display.label} | ${display.detail}`}
        {!compact && <span className="model-select-chev">▾</span>}
      </button>
      {open && (
        <>
          <div className="model-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="model-menu">
            {models.map(m => {
              const parts = modelDisplayParts(m.id);
              return (
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
                    {parts.label} | {parts.detail}
                    {model === m.id && <span className="model-menu-check"> ✓</span>}
                  </span>
                  <span className="model-menu-desc">{m.desc}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="model-menu-manage"
              onClick={() => {
                setOpen(false);
                navigate('/models');
              }}
            >
              管理自定义模型 ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
