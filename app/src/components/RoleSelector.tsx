import { useState } from 'react';
import { WORKBENCH_ROLES, getRole, type RoleId } from '../lib/workbenchRoles';
import { useWorkbenchStore } from '../lib/workbenchStore';

interface RoleSelectorProps {
  threadId: string;
  messagesCount: number;
}

// 角色下拉菜单(纯受控展示件):值与回调由调用方决定——
// 任务工具栏版把值存到 workbench store(按 threadId),首页版存本地 state
// (提交时随新 threadId 写入 store)。菜单形态与千问一致:icon+名称+当前绿勾,无描述文字。
export function RoleSelectMenu({
  value,
  onPick,
}: {
  value: RoleId;
  onPick: (id: RoleId) => void;
}) {
  const [open, setOpen] = useState(false);
  const role = getRole(value);

  return (
    <div className="role-select">
      <button
        type="button"
        className="role-pill"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="选择本任务的场景角色(发出首条消息后锁定)"
      >
        <span className="role-pill-icon" aria-hidden="true">{role.icon}</span>
        {role.label}
        <span className="role-chev">▾</span>
      </button>
      {open && (
        <>
          <div className="model-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="role-menu" role="listbox" onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
          }}>
            {WORKBENCH_ROLES.map(r => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={r.id === value}
                className={`role-menu-item${r.id === value ? ' is-active' : ''}`}
                onClick={() => {
                  onPick(r.id);
                  setOpen(false);
                }}
              >
                <span className="role-menu-icon" aria-hidden="true">{r.icon}</span>
                <span className="role-menu-label">{r.label}</span>
                {r.id === value && <span className="role-menu-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 只在新任务(会话尚无任何消息)时显示选择器;发出首条消息后角色即锁定,
// 组件直接返回 null 让选择器从工具栏消失(F5 角色锁定,对齐千问实机行为:
// 已锁定的会话工具栏没有切换入口,不是禁用态而是完全不出现)。
// 注:当前所有任务都从首页带首条消息创建,这里实际很少有机会显示——
// 主入口是首页输入框的角色胶囊(见 TaskInput/HomePage),本组件保留给
// 未来的空任务路径。
export function RoleSelector({ threadId, messagesCount }: RoleSelectorProps) {
  const roleId = useWorkbenchStore(state => state.roleOf(threadId));
  const setRole = useWorkbenchStore(state => state.setRole);

  if (messagesCount > 0) return null;

  return (
    <RoleSelectMenu
      value={roleId}
      onPick={id => setRole(threadId, id)}
    />
  );
}
