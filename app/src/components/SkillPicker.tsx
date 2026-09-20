import { useEffect, useMemo, useState } from 'react';
import { listExtensions, type SkillMeta } from '../lib/extensionsClient';

// M10 技能选择器:输入框「技能」按钮 → 浮层(启用技能列表+搜索) → 单选置为标签。
// TaskInput(新任务页)与 ChatThread(对话页)两处入口共用。

export function SkillPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);

  // 打开时拉取启用技能;同时挂载即拉一次,用于空态置灰判断
  useEffect(() => {
    listExtensions()
      .then(d => setSkills(d.skills.filter(s => s.enabled)))
      .catch(() => setSkills([]));
  }, [open]);

  const filtered = useMemo(() => {
    if (!skills) return [];
    const kw = search.trim().toLowerCase();
    if (!kw) return skills;
    return skills.filter(
      s => s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw),
    );
  }, [skills, search]);

  const noSkills = skills !== null && skills.length === 0;

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        className="task-input-circle"
        title={noSkills ? '暂无可用技能(可在扩展面板启用)' : '技能'}
        style={noSkills ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
        disabled={noSkills}
        onClick={() => {
          setSearch('');
          setOpen(o => !o);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="6.5" cy="15" r="3.5" /><circle cx="17.5" cy="15" r="3.5" />
          <path d="M10 15h4M3 15V9a2 2 0 0 1 2-2h1.5M21 15V9a2 2 0 0 0-2-2h-1.5" />
        </svg>
      </button>
      {value && (
        <span className="skill-chip" title={`本条消息指定使用技能:${value}`}>
          <span className="skill-chip-name">{value}</span>
          <button
            type="button"
            className="skill-chip-remove"
            title="移除技能"
            onClick={() => onChange(null)}
          >
            ×
          </button>
        </span>
      )}
      {open && (
        <>
          <div
            className="model-menu-backdrop"
            onClick={() => setOpen(false)}
          />
          <div className="skill-pop">
            <input
              className="skill-pop-search"
              placeholder="搜索技能"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="skill-pop-list">
              {filtered.length === 0 ? (
                <div className="skill-pop-empty">{search ? '没有匹配的技能' : '暂无可用技能'}</div>
              ) : (
                filtered.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    className="skill-pop-item"
                    onClick={() => {
                      // 一次只带一个技能:再选即替换
                      onChange(s.name);
                      setOpen(false);
                    }}
                  >
                    <span className="skill-pop-item-name">{s.name}</span>
                    <span className="skill-pop-item-desc">{s.description || '(无描述)'}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
