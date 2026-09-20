import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RoleId } from './workbenchRoles';

interface WorkbenchState {
  rolesByThread: Record<string, RoleId>;
  setRole: (threadId: string, role: RoleId) => void;
  roleOf: (threadId: string | undefined) => RoleId;
}

// 为什么按 threadId 分片存储而不是存一个全局"当前角色":
// 每个会话(thread)在创建时选定角色后就锁定,不同会话之间的角色互不影响,
// 类似千问的 per-chatId 状态分片。用户在会话 A 选"设计师"、切到会话 B
// 应该看到 B 自己的角色(默认通用),不应该被 A 的选择污染。
//
// 为什么要 persist 到 localStorage:
// 角色选择需要在刷新页面、重启应用后仍能恢复(spec F6/F7 会话恢复),
// 纯内存状态刷新即丢。persist 中间件自动把 rolesByThread 序列化进
// localStorage,应用启动时自动反序列化恢复。
export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      rolesByThread: {},
      setRole: (threadId, role) =>
        set(state => ({ rolesByThread: { ...state.rolesByThread, [threadId]: role } })),
      // 无记录(新会话尚未选择、或历史会话是本功能上线前创建的)统一回落 'general',
      // 与 workbenchRoles.ts 的 getRole 兜底逻辑保持一致的语义。
      roleOf: threadId => {
        if (!threadId) return 'general';
        return get().rolesByThread[threadId] ?? 'general';
      },
    }),
    {
      name: 'workbench:sessionRoles',
      // partialize:只持久化 rolesByThread,不持久化函数(函数本来也序列化不了,
      // 这里显式写出是为了让"只存必要状态"的意图在代码里可读)。
      partialize: state => ({ rolesByThread: state.rolesByThread }),
    },
  ),
);
