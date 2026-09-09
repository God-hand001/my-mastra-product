import { API_BASE } from './apiBase';

// 定时任务 HTTP 客户端(M3)

export interface ScheduleView {
  id: string;
  name?: string;
  prompt: string;
  cron: string;
  status: string;
  nextFireAt?: number;
  threadId?: string;
}

const API = `${API_BASE}/schedules`;

export async function listSchedules(): Promise<ScheduleView[]> {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`加载定时任务失败(${res.status})`);
  const data = await res.json();
  return data.schedules ?? [];
}

export async function createSchedule(input: {
  name: string;
  description: string;
  type: 'once' | 'interval' | 'cron';
  at?: string;
  everyN?: number;
  everyUnit?: 'minutes' | 'hours';
  cron?: string;
}): Promise<ScheduleView> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `创建失败(${res.status})`);
  return data as ScheduleView;
}

export async function pauseSchedule(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}/pause`, { method: 'POST' });
  if (!res.ok) throw new Error(`暂停失败(${res.status})`);
}

export async function resumeSchedule(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}/resume`, { method: 'POST' });
  if (!res.ok) throw new Error(`恢复失败(${res.status})`);
}

export async function runScheduleNow(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`立即执行失败(${res.status})`);
}

export async function removeSchedule(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`删除失败(${res.status})`);
}
