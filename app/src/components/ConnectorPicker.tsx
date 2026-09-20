import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  authorizeConnector,
  listExtensions,
  toggleExtension,
  type ConnectorMeta,
} from '../lib/extensionsClient';

// 输入框连接器选择器(D3,2026-09-17):输入框按钮 → 连接器浮层。
// 列出现有连接器(图标+中文名+状态),每项可手动启停;底部「管理连接器」跳转扩展页。
// 取代原先的技能选择浮层(技能已自动触发,无需手动指定)。

/** 连接器状态推导:用于状态徽标文案与颜色 */
function connectorState(c: ConnectorMeta): { label: string; tone: 'ok' | 'warn' | 'error' | 'off' } {
  if (!c.enabled) return { label: '已停用', tone: 'off' };
  if (c.invalid) return { label: '配置无效', tone: 'error' };
  if (c.lastError?.includes('需要授权')) return { label: '待配置', tone: 'warn' };
  if (c.lastError) return { label: '启动失败', tone: 'error' };
  return { label: '就绪', tone: 'ok' };
}

const STATE_COLOR: Record<string, string> = {
  ok: '#30bf69',
  warn: '#d98b0f',
  error: '#e0554d',
  off: '#9a9aa2',
};

export function ConnectorPicker() {
  const [open, setOpen] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();

  const refresh = () => {
    listExtensions()
      .then(d => setConnectors(d.connectors))
      .catch(() => setConnectors([]));
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  // 点击浮层外部关闭:用 mousedown 判定,点击输入框的那次点击在关闭浮层后
  // 仍会正常聚焦输入框 —— 不像全屏遮罩那样吃掉第一次点击(导致"不能输入文字")
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (c: ConnectorMeta) => {
    if (c.invalid) return;
    void act(async () => {
      // 从停用切到启用:声明了未授予能力时先弹确认授权(批准后长期记住)
      if (!c.enabled) {
        const caps = c.config.capabilities as { network?: boolean; externalWrite?: string[] } | undefined;
        const granted = new Set(c.grantedCapabilities ?? []);
        const missing: string[] = [];
        if (caps?.network === true && !granted.has('network')) missing.push('联网');
        if (Array.isArray(caps?.externalWrite) && caps.externalWrite.length > 0 && !granted.has('externalWrite')) {
          missing.push('写外部目录');
        }
        if (missing.length > 0) {
          const ok = window.confirm(
            `启用 ${c.nameZh ?? c.name} 需要授权以下能力:${missing.join('、')}。是否允许?(批准后长期记住)`,
          );
          if (!ok) return;
          await authorizeConnector(c.name);
        }
      }
      await toggleExtension('connector', c.name);
    });
  };

  const pendingCount = (connectors ?? []).filter(
    c => c.enabled && c.lastError?.includes('需要授权'),
  ).length;

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        className="task-input-circle"
        title="连接器"
        onClick={() => setOpen(o => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
          <rect x="7" y="7" width="10" height="8" rx="2" />
          <path d="M4 11v3a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5v-3" />
        </svg>
        {pendingCount > 0 && <span className="connector-badge" />}
      </button>
      {open && (
        <div className="skill-pop connector-pop">
          <div className="connector-pop-head">
            <span className="connector-pop-title">连接器</span>
            {pendingCount > 0 && <span className="connector-pop-beta">待配置 {pendingCount}</span>}
          </div>
          <div className="skill-pop-list">
            {connectors === null ? (
              <div className="skill-pop-empty">加载中…</div>
            ) : connectors.length === 0 ? (
              <div className="skill-pop-empty">暂无连接器</div>
            ) : (
              connectors.map(c => {
                const st = connectorState(c);
                return (
                  <div key={c.name} className="connector-item">
                    <span className="ext-tile-icon" style={{ width: 30, height: 30, fontSize: 15 }}>
                      {(c.icon ?? '').trim() || '🔌'}
                    </span>
                    <div className="connector-item-info">
                      <div className="connector-item-name">{c.nameZh ?? c.name}</div>
                      <div className="connector-item-state" style={{ color: STATE_COLOR[st.tone] }}>
                        {st.label}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`ext-switch${c.enabled ? ' is-on' : ''}`}
                      title={c.enabled ? '点击停用' : '点击启用'}
                      disabled={busy || c.invalid}
                      onClick={() => toggle(c)}
                    >
                      <span className="ext-switch-knob" />
                    </button>
                  </div>
                );
              })
            )}
            {error && <div className="connector-pop-error">{error}</div>}
          </div>
          <button type="button" className="connector-manage-btn" onClick={() => navigate('/extensions')}>
            管理连接器
          </button>
        </div>
      )}
    </span>
  );
}
