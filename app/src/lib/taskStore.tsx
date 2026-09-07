import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { deleteThread, listThreads, type TaskThread } from './agentClient';
import { LOCAL_USER_RESOURCE } from './transport';

// 轻量任务状态(plan:不引 zustand,用 React context)
// 任务 = thread;排序按最近活跃(updatedAt 倒序)

interface TaskStoreValue {
  tasks: TaskThread[];
  loading: boolean;
  currentTaskId: string | null;
  setCurrentTaskId: (id: string | null) => void;
  refresh: () => Promise<void>;
  /** 生成新任务 id 并乐观插入列表,返回 id 供路由跳转 */
  createTask: (firstMessage: string) => string;
  removeTask: (id: string) => Promise<void>;
}

const TaskStoreContext = createContext<TaskStoreValue | null>(null);

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const threads = await listThreads();
      threads.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      setTasks(threads);
    } catch (err) {
      // 后端未启动时界面退化为空列表,不白屏(checklist:前后端独立启动)
      console.error('加载任务列表失败', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback((firstMessage: string) => {
    const id = newTaskId();
    const now = new Date().toISOString();
    // 乐观插入:标题先用任务描述截断,首轮对话结束后端 generateTitle 生成正式标题
    setTasks(prev => [
      {
        id,
        title: firstMessage.trim().slice(0, 30) || '新任务',
        createdAt: now,
        updatedAt: now,
        resourceId: LOCAL_USER_RESOURCE,
      },
      ...prev,
    ]);
    return id;
  }, []);

  const removeTask = useCallback(
    async (id: string) => {
      setTasks(prev => prev.filter(t => t.id !== id));
      try {
        await deleteThread(id);
      } catch (err) {
        console.error('删除任务失败', err);
        await refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ tasks, loading, currentTaskId, setCurrentTaskId, refresh, createTask, removeTask }),
    [tasks, loading, currentTaskId, refresh, createTask, removeTask],
  );

  return <TaskStoreContext.Provider value={value}>{children}</TaskStoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const ctx = useContext(TaskStoreContext);
  if (!ctx) throw new Error('useTaskStore 必须在 TaskStoreProvider 内使用');
  return ctx;
}
