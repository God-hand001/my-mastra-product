import { LOCAL_USER_RESOURCE } from './transport';
import { API_BASE } from './apiBase';

// Mastra server 的线程 REST 接口封装(plan:任务 = thread)
// 标题由后端 generateTitle 自动生成,不做手动重命名(自动标题会覆盖手动修改)

const AGENT_ID = 'agent';

export interface TaskThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  resourceId: string;
}

export async function listThreads(): Promise<TaskThread[]> {
  const res = await fetch(`${API_BASE}/api/memory/threads?resourceId=${LOCAL_USER_RESOURCE}`);
  if (!res.ok) throw new Error(`加载任务列表失败: ${res.status}`);
  const data = await res.json();
  return (data.threads ?? []) as TaskThread[];
}

export async function deleteThread(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/memory/threads/${id}?agentId=${AGENT_ID}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`删除任务失败: ${res.status}`);
}
