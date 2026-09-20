import { API_BASE } from './apiBase';

// 上下文统计与压缩 API
export interface ContextUsage {
  tokens: number;
  maxTokens: number;
  percentage: number;
}

export async function getContextUsage(threadId: string): Promise<ContextUsage> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/context`);
  if (!res.ok) throw new Error(`获取上下文用量失败: ${res.status}`);
  return (await res.json()) as ContextUsage;
}

export interface CompressResult {
  ok: boolean;
  reason?: string;
  deletedCount?: number;
  tokensBefore?: number;
  tokensAfter?: number;
}

export async function compressContext(threadId: string): Promise<CompressResult> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/compress`, { method: 'POST' });
  return (await res.json()) as CompressResult;
}