import { API_BASE } from './apiBase';

// M10 扩展体系 HTTP 客户端：技能/连接器列表、开关、详情、导入
export interface SkillMeta {
  name: string;
  description: string;
  source: 'builtin' | 'local';
  enabled: boolean;
  dir: string;
  nameZh?: string;
  descZh?: string;
  icon?: string;
  category?: string;
}

export interface ConnectorMeta {
  name: string;
  description: string;
  config: Record<string, unknown>;
  source?: 'builtin' | 'local';
  enabled: boolean;
  lastError: string | null;
  invalid: boolean;
  grantedCapabilities?: string[];
  nameZh?: string;
  descZh?: string;
  icon?: string;
  category?: string;
}

export interface ExtensionsView {
  skills: SkillMeta[];
  connectors: ConnectorMeta[];
}

const API = `${API_BASE}/extensions`;

export async function listExtensions(): Promise<ExtensionsView> {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`加载扩展列表失败(${res.status})`);
  const data = await res.json();
  return { skills: data.skills ?? [], connectors: data.connectors ?? [] };
}

export async function toggleExtension(kind: 'skill' | 'connector', name: string): Promise<void> {
  const res = await fetch(`${API}/${kind}/${encodeURIComponent(name)}/toggle`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `切换失败(${res.status})`);
  }
}

export async function authorizeConnector(name: string, capabilities?: string[]): Promise<string[]> {
  const res = await fetch(`${API}/connectors/${encodeURIComponent(name)}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(capabilities === undefined ? {} : { capabilities }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `授权失败(${res.status})`);
  return data.granted ?? [];
}

export async function getSkillDetail(name: string): Promise<{ content: string; dir: string }> {
  const res = await fetch(`${API}/skills/${encodeURIComponent(name)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `读取技能详情失败${res.status})`);
  }
  return { content: data.content ?? '', dir: data.dir ?? '' };
}

export async function importExtension(localPath: string, kind: 'skill' | 'connector'): Promise<void> {
  const res = await fetch(`${API}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localPath, kind }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `导入失败(${res.status})`);
}
