import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// 项目系统存储(H0)
// 项目 = { id, name, dir };线程绑定关系 = { threadId, projectId }
// 持久化:storage/projects.json(重启不丢,N2)

const STORE_PATH = path.resolve('storage/projects.json');

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

interface StoreShape {
  projects: Project[];
  links: ThreadLink[];
}

async function loadStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { projects: parsed.projects ?? [], links: parsed.links ?? [] };
  } catch {
    return { projects: [], links: [] };
  }
}

async function saveStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export async function listProjects(): Promise<Project[]> {
  const { projects } = await loadStore();
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createProject(input: { name: string; dir?: string }): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new Error('项目名称不能为空');
  const dir = input.dir?.trim();
  const { projects } = await loadStore();
  // 目录唯一性:同一目录不允许注册为两个项目(N1 防混淆)
  if (dir) {
    const normalized = path.resolve(dir).toLowerCase();
    const dup = projects.find(p => path.resolve(p.dir).toLowerCase() === normalized);
    if (dup) throw new Error(`该目录已注册为项目「${dup.name}」`);
  }
  const project: Project = {
    id: randomUUID(),
    name,
    dir: dir ?? '',
    createdAt: new Date().toISOString(),
  };
  await saveStore({ projects: [project, ...projects], links: (await loadStore()).links });
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const store = await loadStore();
  await saveStore({
    projects: store.projects.filter(p => p.id !== id),
    // 绑定关系一并解除;线程本身保留(spec F1)
    links: store.links.filter(l => l.projectId !== id),
  });
}

export async function linkThread(threadId: string, projectId: string): Promise<void> {
  const store = await loadStore();
  if (!store.projects.some(p => p.id === projectId)) {
    throw new Error(`项目不存在: ${projectId}`);
  }
  const links = store.links.filter(l => l.threadId !== threadId); // 一线程至多属一项目
  links.push({ threadId, projectId, linkedAt: new Date().toISOString() });
  await saveStore({ ...store, links });
}

export async function getLinks(): Promise<ThreadLink[]> {
  return (await loadStore()).links;
}

export async function getProjectThreads(projectId: string): Promise<string[]> {
  return (await loadStore()).links.filter(l => l.projectId === projectId).map(l => l.threadId);
}

// 校验请求携带的 projectDir 是否为已注册项目的目录(N1/AC5)
// 命中返回归一化后的注册目录,未命中返回 null
export async function resolveProjectDir(projectDir: string): Promise<string | null> {
  const { projects } = await loadStore();
  const requested = path.resolve(projectDir).toLowerCase();
  const hit = projects.find(p => p.dir && path.resolve(p.dir).toLowerCase() === requested);
  return hit ? path.resolve(hit.dir) : null;
}
