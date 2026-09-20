import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { listExtensions, type SkillMeta } from '../lib/extensionsClient';

// 斜杠技能菜单(D3,2026-09-17):输入框输入「/」弹出技能筛选列表(千问形态)。
// 规则:光标前最近的「/」必须位于行首或空白/括号之后,且到光标之间无空白 ——
// 此时「/」后缀作为筛选词;选中后把「/筛选词」从文本中移除并回填技能。
// TaskInput(新任务页)与 ChatThread(对话页)共用本模块。

let skillsCache: SkillMeta[] | null = null;
let skillsCacheAt = 0;

async function loadSkills(): Promise<SkillMeta[]> {
  // 2 分钟缓存:技能列表变化低频,避免每次输入都请求
  if (skillsCache && Date.now() - skillsCacheAt < 120_000) return skillsCache;
  const d = await listExtensions();
  const enabled = d.skills.filter(s => s.enabled);
  skillsCache = enabled;
  skillsCacheAt = Date.now();
  return enabled;
}

export interface SlashState {
  /** 触发字符「/」在文本中的位置 */
  start: number;
  keyword: string;
}

/** 检测光标处是否处于斜杠筛选状态 */
export function detectSlash(value: string, cursor: number): SlashState | null {
  const before = value.slice(0, cursor);
  const idx = before.lastIndexOf('/');
  if (idx === -1) return null;
  const chBefore = idx === 0 ? '\n' : before[idx - 1];
  // 「/」须位于行首、空白或全角括号之后,避免把路径/网址里的斜杠当成触发
  if (!/[\s\n(（「【]/.test(chBefore)) return null;
  const keyword = before.slice(idx + 1);
  if (/[\s\n]/.test(keyword)) return null;
  return { start: idx, keyword };
}

export function useSlashSkills(opts: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setText: (t: string) => void;
  /** 选中技能:参数为完整技能元数据(名称/图标/中文名供 chip 展示) */
  onPick: (name: string, meta: SkillMeta) => void;
}) {
  const { textareaRef, value, setText, onPick } = opts;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selIndex, setSelIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const open = slash != null;

  // 菜单打开时拉取技能(带缓存)
  useEffect(() => {
    if (!open) return;
    void loadSkills().then(setSkills);
    setSelIndex(0);
  }, [open]);

  const filtered = (() => {
    if (!slash) return [];
    const kw = slash.keyword.toLowerCase();
    if (!kw) return skills;
    return skills.filter(s => {
      const hay = [s.name, s.nameZh, s.descZh, s.description]
        .map(x => (x ?? '').toLowerCase())
        .join(' ');
      return hay.includes(kw);
    });
  })();

  /** 输入组件 onChange 时调用:根据光标位置更新斜杠状态 */
  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    const st = detectSlash(el.value, el.selectionStart ?? el.value.length);
    setSlash(st);
    if (st) void loadSkills().then(setSkills);
  };

  /** 选中技能:移除「/筛选词」片段,回调技能名 */
  const pick = (s: SkillMeta) => {
    if (!slash) return;
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? slash.start + slash.keyword.length + 1;
    const next = value.slice(0, slash.start) + value.slice(cursor);
    setText(next);
    onPick(s.name, s);
    setSlash(null);
    // 光标落回删除点
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(slash.start, slash.start);
      }
    });
  };

  const move = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    setSelIndex(i => (i + dir + filtered.length) % filtered.length);
  };

  /** 输入组件 onKeyDown 时调用:返回 true 表示按键已被菜单消费 */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown') { move(1); return true; }
    if (e.key === 'ArrowUp') { move(-1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const s = filtered[selIndex];
      if (s) { e.preventDefault(); pick(s); return true; }
      return false;
    }
    if (e.key === 'Escape') { setSlash(null); return true; }
    return false;
  };

  // 高亮选中项滚动到可视区
  useEffect(() => {
    listRef.current?.querySelector('.slash-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [selIndex]);

  const close = () => setSlash(null);

  return { open, slash, items: filtered, selIndex, listRef, handleInput, handleKeyDown, pick, close };
}

/** 菜单渲染(absolute 定位:挂在输入框容器内,自动贴输入框上方) */
export function SlashSkillMenu({
  items,
  selIndex,
  listRef,
  onPick,
}: {
  items: SkillMeta[];
  selIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  onPick: (s: SkillMeta) => void;
}) {
  return (
    <div ref={listRef} className="slash-skill-menu">
      {items.length === 0 ? (
        <div className="slash-item-empty">没有匹配的技能</div>
      ) : (
        items.map((s, i) => (
          <button
            key={s.name}
            type="button"
            className={`slash-item${i === selIndex ? ' is-active' : ''}`}
            onMouseDown={e => e.preventDefault()} // 避免点击时 textarea 失焦
            onClick={() => onPick(s)}
          >
            <span className="slash-item-icon">{(s.icon ?? '').trim() || '🧩'}</span>
            <span className="slash-item-name">{s.nameZh ?? s.name}</span>
            <span className="slash-item-desc">{s.descZh ?? s.description}</span>
          </button>
        ))
      )}
      <div className="slash-item-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </div>
  );
}
