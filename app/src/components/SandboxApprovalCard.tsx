import { createContext, useContext, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { API_BASE } from '../lib/apiBase';

// 审批卡片数据类型(由 @mastra/ai-sdk 的 data-tool-call-approval / data-tool-call-suspended 提供)
export type ApprovalCardData =
  | {
      state: 'data-tool-call-approval';
      runId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      resumeSchema?: unknown;
    }
  | {
      state: 'data-tool-call-suspended';
      runId: string;
      toolCallId: string;
      toolName: string;
      suspendPayload: {
        command?: string;
        reason?: string;
        [key: string]: unknown;
      };
      resumeSchema?: unknown;
    };

type DecisionMode = 'once' | 'session';

// 本地"已决定"抑制表(模块级,刻意不放组件 state)。
// 原因:决定成功后会触发历史重载 → 聊天组件**重新挂载** → 卡片是全新实例
// (done=false),按钮又冒出来;而后端挂起快照要等续跑推进才消失,在途的旧轮询
// 响应也可能把它带回来。两者叠加就是"点完消失、马上又弹"(2026-09-17 用户实测)。
// 模块级 Set 跨重挂载存活,配合后端的同名过滤形成双保险。
const locallyDecided = new Set<string>();
const decidedKeyOf = (runId: string, toolCallId: string) => `${runId}|${toolCallId}`;

export function markDecidedLocally(runId: string, toolCallId: string): void {
  locallyDecided.add(decidedKeyOf(runId, toolCallId));
}

export function isDecidedLocally(runId: string, toolCallId: string): boolean {
  return locallyDecided.has(decidedKeyOf(runId, toolCallId));
}

// 待决审批共享上下文:由 ChatThread 统一轮询后端待决列表并下发,
// 供审批弹窗与"任务已完成"折叠行共用(避免两处各自轮询)。
export const PolledApprovalsContext = createContext<ApprovalCardData[]>([]);

// ── "续跑中"状态 ──────────────────────────────────────────────────────
// 决定提交成功后,后端立即返回、续跑转后台执行。这段时间里流已结束、待决列表
// 也空了,但任务并没完成 —— 必须显示"正在执行"且计时继续,而不是"任务已完成"
// (2026-09-17 用户定向)。
// 模块级存储:决定后会触发历史重载并重挂载组件,组件 state 存不住。
// baselineLen:标记时最后一条 assistant 消息的文本长度;续跑产出新内容(长度增长)
// 即视为完成并清除。TTL 兜底防止后台异常时永久显示"正在执行"。
// at:点击授权的时刻(用于扣除等待时长);baselineLen:授权时的历史文本总长度;
// finishedAt:续跑产出新内容的时刻(由拉取历史的一层判定后写入)。
type ResumingRecord = { at: number; baselineLen?: number; finishedAt?: number };
const resumingThreads = new Map<string, ResumingRecord>();
const RESUMING_TTL_MS = 5 * 60 * 1000;

export function markThreadResuming(threadId: string): void {
  if (threadId) resumingThreads.set(threadId, { at: Date.now() });
}

export function clearThreadResuming(threadId: string): void {
  resumingThreads.delete(threadId);
}

/** 读取"续跑中"记录;超过 TTL 自动失效 */
export function getThreadResuming(threadId: string): ResumingRecord | undefined {
  const rec = resumingThreads.get(threadId);
  if (!rec) return undefined;
  if (Date.now() - rec.at > RESUMING_TTL_MS) {
    resumingThreads.delete(threadId);
    return undefined;
  }
  return rec;
}

/** 首次进入续跑时记录文本基线,用于判断续跑是否已产出新内容 */
export function setResumingBaseline(threadId: string, len: number): void {
  const rec = resumingThreads.get(threadId);
  if (rec && rec.baselineLen == null) rec.baselineLen = len;
}

/**
 * 标记续跑已完成(产出了新内容)。
 * 只打时间戳、不立即删除记录 —— 计时组件需要 at/finishedAt 这两个时刻来结算耗时,
 * 结算完才由它删除。
 */
export function finishThreadResuming(threadId: string): void {
  const rec = resumingThreads.get(threadId);
  if (rec && rec.finishedAt == null) rec.finishedAt = Date.now();
}

// 是否处于"续跑中"(供折叠行文案与计时器共用)
export const ResumingContext = createContext(false);

/**
 * 合并两路数据源得到当前线程的待决审批卡片:
 * 1. 实时流部件(挂起瞬间即可见,但不落库、重挂载即丢失)
 * 2. 后端待决列表(权威,跨重挂载/刷新存活,由上层轮询经 Context 下发)
 * 已本地决定过的一律剔除。
 */
export function usePendingApprovalCards(): ApprovalCardData[] {
  const polled = useContext(PolledApprovalsContext);
  // 选择器返回 store 里的 messages 原引用(引用稳定),过滤在下方做
  const messages = useAuiState(
    (s: { thread: { messages?: ReadonlyArray<unknown> } }) => s.thread.messages,
  );
  const streamCards = (messages ?? []).flatMap(m =>
    extractApprovalParts((m as { parts?: ReadonlyArray<unknown> }).parts),
  );
  const merged = new Map<string, ApprovalCardData>();
  for (const card of [...streamCards, ...polled]) {
    if (isDecidedLocally(card.runId, card.toolCallId)) continue;
    merged.set(`${card.runId}:${card.toolCallId}`, card);
  }
  return [...merged.values()];
}

// 从消息 parts 中提取审批数据部件。
// ⚠️ 兼容两种形态:AI SDK v5 实际下发的是 {type:'data-tool-call-suspended', data},
// 早期实现误以为是 {type:'data', name:'tool-call-suspended', data} —— 后者永远匹配不上,
// 导致卡片从未渲染过(2026-09-17 用户实测发现)。
export function extractApprovalParts(parts: ReadonlyArray<unknown> | undefined | null): ApprovalCardData[] {
  const out: ApprovalCardData[] = [];
  for (const part of parts ?? []) {
    const p = part as { type?: string; name?: string; data?: unknown };
    let d: unknown;
    if (p.type === 'data-tool-call-approval' || p.type === 'data-tool-call-suspended') {
      d = p.data;
    } else if (
      p.type === 'data' &&
      (p.name === 'tool-call-approval' || p.name === 'tool-call-suspended')
    ) {
      d = p.data;
    } else {
      continue;
    }
    const cand = d as ApprovalCardData | undefined;
    if (cand?.state != null) out.push(cand);
  }
  return out;
}

interface SandboxApprovalCardProps {
  data: ApprovalCardData;
  threadId: string;
  onDecisionAccepted: () => void;
}

// 从 approval 的 args 中尽量读出目标命令或操作对象
function readCommandTarget(data: ApprovalCardData): string {
  if (data.state === 'data-tool-call-suspended') {
    return data.suspendPayload.command ?? '(未知命令)';
  }
  const args = data.args as Record<string, unknown> | undefined;
  if (args && typeof args === 'object') {
    const command = args.command;
    if (typeof command === 'string') return command;
    const path = args.path;
    if (typeof path === 'string') return path;
  }
  return JSON.stringify(data.args ?? null);
}

// 读出被拒原因(仅 suspended 类型有)
function readReason(data: ApprovalCardData): string | undefined {
  if (data.state === 'data-tool-call-suspended') {
    return data.suspendPayload.reason;
  }
  return undefined;
}

export function SandboxApprovalCard({ data, threadId, onDecisionAccepted }: SandboxApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // 无倒计时(2026-09-17 用户定向):待决审批一直等待用户决定,不自动拒绝。

  const isSuspended = data.state === 'data-tool-call-suspended';
  const target = readCommandTarget(data);
  const reason = readReason(data);

  const submit = async (decision: 'approved' | 'declined', mode: DecisionMode, reasonText?: string) => {
    if (submitting || done) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/sandbox/approvals/${data.runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          toolCallId: data.toolCallId,
          decision,
          mode,
          reason: reasonText,
        }),
      });
      const body = (await res.json().catch(() => ({ error: '无法解析后端响应' }))) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok !== true) {
        throw new Error(body.error ?? `请求失败(${res.status})`);
      }
      // 先落本地抑制标记再通知外层重载:重载会重挂载组件,标记必须已生效
      markDecidedLocally(data.runId, data.toolCallId);
      // 决定已提交、续跑在后台进行:进入"正在执行"状态(计时继续),
      // 直到续跑产出新内容才恢复"任务已完成"
      markThreadResuming(threadId);
      setDone(true);
      onDecisionAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="approval-card">
        <div className="approval-card-done">✓ 已处理</div>
      </div>
    );
  }

  return (
    <div className="approval-card">
      <div className="approval-card-head">
        <span className="approval-card-title">允许该操作?</span>
        <span className="approval-card-countdown">等待你的决定</span>
      </div>
      <pre className="approval-card-command">{target}</pre>
      {reason && <div className="approval-card-reason">{reason}</div>}

      <div className="approval-card-actions">
        <button
          type="button"
          className="approval-option is-primary"
          disabled={submitting}
          onClick={() => submit('approved', 'once')}
        >
          允许本次
        </button>
        {isSuspended && (
          <button
            type="button"
            className="approval-option"
            disabled={submitting}
            onClick={() => submit('approved', 'session')}
          >
            允许,本会话内同类操作不再询问
          </button>
        )}
        <button
          type="button"
          className="approval-option"
          disabled={submitting}
          onClick={() => submit('declined', 'once', '用户拒绝')}
        >
          拒绝
        </button>
      </div>
      {error && <div className="approval-card-error">后端错误: {error}</div>}
    </div>
  );
}
