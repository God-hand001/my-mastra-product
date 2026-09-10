import { API_BASE } from './apiBase';
import { desktopBridge } from './desktop';

// 项目系统 HTTP 客户端(H0,桌面端专属功能)

export interface Project {
  id: string;
  name: string;
  dir: string;
  createdAt: string;
}

export interface ThreadLink {
  threadId: string;
  projectId: string;
  linkedAt: string;
}

const API = `${API_BASE}/projects`;

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${API}?${Date.now()}`);
  if (!res.ok) throw new Error(`加载项目失败(${res.status})`);
  const data = await res.json();
  return data.projects ?? [];
}

export async function createProject(input: { name: string; dir?: string }): Promise<Project> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `创建失败(${res.status})`);
  return data as Project;
}

export async function removeProject(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除失败(${res.status})`);
}

export async function linkThread(threadId: string, projectId: string): Promise<void> {
  const res = await fetch(`${API}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, projectId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `绑定失败(${res.status})` }));
    throw new Error(data.error ?? `绑定失败(${res.status})`);
  }
}

export async function getLinks(): Promise<ThreadLink[]> {
  const res = await fetch(`${API}/links?${Date.now()}`);
  if (!res.ok) throw new Error(`加载绑定关系失败(${res.status})`);
  const data = await res.json();
  return data.links ?? [];
}

// 选择工作目录:桌面端弹原生选择框;浏览器无此能力(返回 null)
export async function selectDirectory(): Promise<string | null> {
  return (await desktopBridge()?.selectDirectory()) ?? null;
}
