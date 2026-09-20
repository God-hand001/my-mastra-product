import { useState } from 'react';

export type PermissionMode = 'default' | 'full';

const PERMISSION_KEY = 'chat-permission';

export function loadPermission(): PermissionMode {
  return localStorage.getItem(PERMISSION_KEY) === 'full' ? 'full' : 'default';
}

function savePermission(mode: PermissionMode) {
  localStorage.setItem(PERMISSION_KEY, mode);
}

export function PermissionSelect() {
  const [permOpen, setPermOpen] = useState(false);
  const [permission, setPermission] = useState<PermissionMode>(loadPermission);

  const selectPermission = (mode: PermissionMode) => {
    setPermission(mode);
    savePermission(mode);
    setPermOpen(false);
  };

  return (
    <div className="permission-select">
      <button
        type="button"
        className={`permission-pill${permission === 'full' ? ' is-full' : ''}`}
        onClick={() => setPermOpen(open => !open)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        {permission === 'default' ? '默认权限' : '完全访问权限'}
        <span className="permission-chev">▾</span>
      </button>
      {permOpen && (
        <>
          <div className="model-menu-backdrop" onClick={() => setPermOpen(false)} />
          <div className="permission-menu">
            <button
              type="button"
              className={`permission-menu-item${permission === 'default' ? ' is-active' : ''}`}
              onClick={() => selectPermission('default')}
            >
              <span className="permission-menu-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                默认权限
              </span>
              <span className="permission-menu-desc">沿用当前安全策略，需要时请求你的批准</span>
              {permission === 'default' && <span className="permission-menu-check">✓</span>}
            </button>
            <button
              type="button"
              className={`permission-menu-item is-danger${permission === 'full' ? ' is-active' : ''}`}
              onClick={() => selectPermission('full')}
            >
              <span className="permission-menu-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
                </svg>
                完全访问权限
              </span>
              <span className="permission-menu-desc">自动批准权限请求，可能执行高风险操作</span>
              {permission === 'full' && <span className="permission-menu-check">✓</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
