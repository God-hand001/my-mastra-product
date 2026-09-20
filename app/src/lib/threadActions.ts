import { API_BASE } from './apiBase';
import type { TaskThread } from './agentClient';
import type { MastraMessage } from './messages';
import { LOCAL_USER_RESOURCE } from './transport';

const PINNED_TASKS_KEY = 'h0-pinned-tasks';
const ARCHIVED_TASKS_KEY = 'h0-archived-tasks';
const AGENT_ID = 'agent';

function readIdList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// 任务置顶只保存在本地,不改后端记忆数据
export function getPinnedTasks(): string[] {
  return readIdList(PINNED_TASKS_KEY);
}

export function togglePinnedTask(id: string): string[] {
  const pinned = getPinnedTasks();
  const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [id, ...pinned];
  localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify(next));
  return next;
}

export function getArchivedTasks(): string[] {
  return readIdList(ARCHIVED_TASKS_KEY);
}

export function setArchivedTasks(ids: string[]): void {
  localStorage.setItem(ARCHIVED_TASKS_KEY, JSON.stringify(ids));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getMessageText(message: MastraMessage): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content?.parts ?? [])
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join('');
}

function downloadMarkdown(thread: TaskThread, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${thread.title || '未命名任务'}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

// 导出当前线程的文本消息,工具调用等非文本内容不进入 Markdown
export async function exportThreadToMarkdown(thread: TaskThread): Promise<void> {
  const url = `${API_BASE}/api/memory/threads/${thread.id}/messages?agentId=${AGENT_ID}&resourceId=${encodeURIComponent(LOCAL_USER_RESOURCE)}&page=0&perPage=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`导出对话记录失败: ${res.status}`);
  const data = await res.json();
  const messages = (data.messages ?? []) as MastraMessage[];
  const lines = [`# ${thread.title || '未命名任务'}`];

  for (const message of messages) {
    const text = getMessageText(message);
    if (!text) continue;
    const role = message.role === 'assistant' ? '助手' : '用户';
    const time = formatDateTime(message.createdAt);
    lines.push('', `**${role}**${time ? ` ${time}` : ''}`, '', text);
  }

  downloadMarkdown(thread, lines.join('\n'));
}
