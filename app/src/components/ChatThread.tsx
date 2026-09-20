import { createContext, useContext, useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { API_BASE } from '../lib/apiBase';
import {
  ActionBarPrimitive,
  AssistantRuntime,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import { AttachmentBar } from './AttachmentBar';
import { attachmentSection } from '../lib/transport';
import { ModelSelect } from './ModelSelect';
import { PermissionSelect } from './PermissionSelect';
import { RoleSelector } from './RoleSelector';
import { getRole } from '../lib/workbenchRoles';
import { useWorkbenchStore } from '../lib/workbenchStore';
import { ConnectorPicker } from './ConnectorPicker';
import { useSlashSkills, SlashSkillMenu } from './SlashSkillMenu';
import type { PickedAttachment } from '../lib/driveClient';
import { getContextUsage, compressContext, type ContextUsage } from '../lib/contextClient';
import { AnswerParts, StepsFold, computePhaseLabel, useAnswerBoundary, useHasProcessSteps, RoleArtifactTypeContext } from './AssistantSteps';
import {
  SandboxApprovalCard,
  PolledApprovalsContext,
  usePendingApprovalCards,
  clearThreadResuming,
  type ApprovalCardData,
} from './SandboxApprovalCard';

// 点击 ↻ 时上报被替换的旧 assistant 消息 id,由 TaskPage 在流式结束后清理 memory。
// 用 Context 传递:AssistantMessage 挂在 ThreadPrimitive.Messages 内部,拿不到外层 props。
// M16:自定义面板类挂起的 toolName 集合——这些挂起不渲染成"允许该操作?"审批卡,
// 而是各自在右侧 PreviewPanel 里有专属面板(问题表单/设计计划确认卡)。
// 新增第三种自定义面板类型时,只需要在这里加一行,不用再改下面的判断逻辑。
const CUSTOM_PANEL_TOOL_NAMES = new Set(['ask_user', 'enter_design_plan']);

// 三态查表:不同 toolName 在状态行/折叠行里显示的等待文案
const WAITING_LABELS: Record<string, string> = {
  ask_user: '等待你的回答…',
  enter_design_plan: '等待你的确认…',
};

const RegenerateContext = createContext<(messageId: string) => void>(() => {});
const ApprovalContext = createContext<() => void>(() => {});

// 前端自行维护每条 assistant 消息的耗时统计(刷新页面后 Map 清空,历史消息不显示错误数字)
// 放在模块级避免 ChatThread 因 TaskPage key 变化重挂载时被重建为空。
// pausedMs:等待用户授权的时长,从耗时里扣除。
// 挂起时流会正常结束(endMs 落在挂起那刻),用户思考到点击授权之间的间隔不该算进
// 任务耗时 —— 扣掉它,授权后计时才是从原来的秒数"接着走",而不是跳成总时长。
type TimingRecord = { startMs?: number; endMs?: number; tokens?: number; pausedMs?: number };
const timingStore = new Map<string, TimingRecord>();

// 向 ThreadPrimitive.Messages 内部组件传递 threadId,用于构造兜底键。
const ThreadContext = createContext<{ threadId: string } | null>(null);

// 按主键(消息 id)与兜底键(线程内第几条 assistant)两种方式查计时记录。
// 兜底键存在的原因:同一条回复在流式阶段是 AI SDK 短 id,落库后变成 Mastra UUID。
function lookupTiming(
  threadId: string,
  messages: ReadonlyArray<{ id: string; role: string }>,
  id: string,
): TimingRecord | undefined {
  const direct = timingStore.get(id);
  if (direct) return direct;
  const index = getAssistantIndex(messages, id);
  return index >= 0 ? timingStore.get(`${threadId}#${index}`) : undefined;
}

/**
 * 重新生成时把该条消息的计时记录**重置为全新的进行中记录**(startMs=此刻)。
 *
 * 为何必须重置:兜底键是"线程内第几条 assistant",重新生成后索引不变 —— 旧记录
 * (含已固化的 pausedMs 与 endMs)会被新回复继承,表现为耗时接着旧值累加而不是
 * 重新计时(2026-09-17 用户反馈)。
 * 为何是"重置"而不是"删除":重新生成可能复用同一条消息 id,此时订阅逻辑的
 * "快照外新消息"绑定条件不成立,删除后不会补建记录,计时就整个不显示了。
 * 预置一条进行中的记录,订阅逻辑会把它当作 in-flight 直接接管。
 */
function restartTiming(threadId: string, assistantIndex: number, messageId: string): void {
  const record: TimingRecord = { startMs: Date.now() };
  timingStore.set(messageId, record);
  if (assistantIndex >= 0) timingStore.set(`${threadId}#${assistantIndex}`, record);
}

// 计算目标消息在线程中是第几条 assistant 消息(从 0 开始),用于兜底键。
function getAssistantIndex(
  messages: ReadonlyArray<{ id: string; role: string }>,
  targetId: string,
): number {
  let idx = 0;
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (m.id === targetId) return idx;
    idx++;
  }
  return -1;
}

// 附件段落渲染为独立的可下载文档卡片
// 标记格式:【附件:文件名(大小)#网盘id】;标记后的附件全文不显示在气泡里
function UserText({ text }: TextMessagePartProps) {
  const first = /【附件:(.+?)(?:[（(]([^）)]+)[）)])?(?:#([0-9a-f-]{36}))?】/.exec(text);
  if (!first) {
    return <div className="msg-user-text">{text}</div>;
  }
  const before = text.slice(0, first.index).trim();
  const cards: { name: string; size?: string; id?: string }[] = [];
  const re = /【附件:(.+?)(?:[（(]([^）)]+)[）)])?(?:#([0-9a-f-]{36}))?】/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    cards.push({ name: m[1], size: m[2], id: m[3] });
  }
  return (
    <>
      {before && <div className="msg-user-text">{before}</div>}
      {cards.map((c, i) => {
        const ext = (c.name.split('.').pop() ?? '').toLowerCase();
        const badge = ext === 'docx' ? 'W' : ext === 'xlsx' ? 'X' : ext === 'pdf' ? 'P' : '📄';
        const inner = (
          <>
            <span className={`msg-file-icon file-${ext || 'default'}`}>{badge}</span>
            <div className="msg-file-info">
              <div className="msg-file-name">{c.name}</div>
              <div className="msg-file-size">
                {ext.toUpperCase()}
                {c.size ? ` · ${c.size}` : ''}
              </div>
            </div>
          </>
        );
        return c.id ? (
          <a
            key={i}
            className="msg-file-card"
            href={`${API_BASE}/drive/files/${c.id}/download`}
            download={c.name}
            title="点击下载"
          >
            {inner}
          </a>
        ) : (
          <div key={i} className="msg-file-card">
            {inner}
          </div>
        );
      })}
    </>
  );
}

// 消息操作图标(线性风格,尺寸/描边与输入区图标一致)
function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

// "2026-09-11 11:51:08"
// 历史消息取 Mastra 透传的真实 createdAt(见 lib/messages.ts,落在 metadata.custom);
// 实时消息回退到 assistant-ui 的 createdAt —— 它是转换时刻,而此刻就是发送时刻,无偏差。
// (@assistant-ui/ai-sdk 的转换器对所有消息都用 `new Date()`,
//  所以刷新页面后若不透传就会全变成"刚刚")
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function MessageTimestamp() {
  const text = useAuiState(
    (s: { message: { createdAt: Date; metadata?: { custom?: Record<string, unknown> } } }) => {
      const raw = s.message.metadata?.custom?.createdAt;
      const d = typeof raw === 'string' ? new Date(raw) : s.message.createdAt;
      return Number.isNaN(d.getTime()) ? null : formatTimestamp(d);
    },
  );
  if (!text) return null;
  return <span className="msg-timestamp">{text}</span>;
}

function UserMessage() {
  return (
    <div className="msg msg-user">
      <MessagePrimitive.Parts components={{ Text: UserText }} />
      <div className="msg-footer">
        <MessageTimestamp />
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="msg-action-btn" title="复制">
            <CopyIcon />
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
      </div>
    </div>
  );
}

function ChatMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.If user>
        <UserMessage />
      </MessagePrimitive.If>
      <MessagePrimitive.If assistant>
        <AssistantMessage />
      </MessagePrimitive.If>
    </MessagePrimitive.Root>
  );
}

// 回复耗时与 token 用量(P2:流式中实时显示,完成后显示总耗时)
function MessageStats() {
  const threadCtx = useContext(ThreadContext);
  const [tick, setTick] = useState(0);
  const messageId = useAuiState((s: { message: { id: string } }) => s.message.id);
  const assistantIndex = useAuiState((s: {
    thread: { messages: ReadonlyArray<{ id: string; role: string }> };
    message: { id: string };
  }) => getAssistantIndex(s.thread.messages, s.message.id));
  // 取文本用 message.parts:这是项目其它组件(AssistantSteps)一直在用的字段,
  // 确定存在;之前用 message.content + 类型断言会绕过类型检查,该字段不存在时会抛错。
  const text = useAuiState((s: { message: { parts?: ReadonlyArray<{ type: string; text?: string }> } }) =>
    (s.message.parts ?? [])
      .filter(part => part.type === 'text' || part.type === 'reasoning')
      .map(part => part.text ?? '')
      .join(''),
  );
  const usageTokens = useAuiState((s) => {
    const meta = s.message.metadata as { usage?: { totalTokens?: number; completionTokens?: number } } | undefined;
    return meta?.usage?.totalTokens ?? meta?.usage?.completionTokens;
  });

  const threadId = threadCtx?.threadId;

  // 查表顺序:先按 messageId,再按兜底键;都没有则返回 null。
  const lookupRecord = (): TimingRecord | undefined =>
    timingStore.get(messageId) ??
    (threadId != null && assistantIndex >= 0
      ? timingStore.get(`${threadId}#${assistantIndex}`)
      : undefined);

  // 流式进行中每 200ms 刷新一次,实现实时秒数
  useEffect(() => {
    const record = lookupRecord();
    if (record?.startMs != null && record.endMs == null) {
      const id = setInterval(() => setTick(v => v + 1), 200);
      return () => clearInterval(id);
    }
  }, [messageId, assistantIndex, threadId]);

  const record = lookupRecord();
  // 关键:没有本次会话的计时记录(如刷新后的历史消息)直接不显示
  if (!record || record.startMs == null) return null;

  const endMs = record.endMs ?? Date.now();
  const ms = endMs - record.startMs;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1000;

  // token 数:优先取真实 usage,否则按与后端一致的系数估算(2.5 字符/token)
  let tokenSuffix = '';
  if (usageTokens != null) {
    tokenSuffix = ' · ' + usageTokens + ' tokens';
  } else if (record.tokens != null) {
    tokenSuffix = ' · ' + record.tokens + ' tokens';
  } else if (text.length > 0) {
    tokenSuffix = ' · 约 ' + Math.ceil(text.length / 2.5) + ' tokens';
  }

  return (
    <span className="msg-duration">
      ⏱ {seconds < 60 ? seconds.toFixed(1) + ' 秒' : Math.floor(seconds / 60) + ' 分 ' + Math.round(seconds % 60) + ' 秒'}
      {tokenSuffix}
    </span>
  );
}

function AssistantMessage() {
  // thread.isRunning 是整个会话的运行状态；只有当前消息是最后一条时才说明它正在流式，避免历史消息同时显示转圈。
  const isStreaming = useAuiState(
    (s: { thread: { isRunning: boolean }; message: { isLast: boolean } }) =>
      s.thread.isRunning && s.message.isLast,
  );
  // 当前 assistant 消息 id:重新生成后要按 id 把这条旧回复从 memory 删掉
  const messageId = useAuiState((s: { message: { id: string } }) => s.message.id);
  const onRegenerateStart = useContext(RegenerateContext);
  // 重新生成时要重置计时,需要 threadId 与本条 assistant 的序号来定位记录
  const threadCtxForTiming = useContext(ThreadContext);
  const assistantIndexForTiming = useAuiState((s: {
    thread: { messages: ReadonlyArray<{ id: string; role: string }> };
    message: { id: string };
  }) => getAssistantIndex(s.thread.messages, s.message.id));
  // answerStart:结尾连续文本 part 的起始索引,之前的都算"中间步骤"
  // (纯闲聊没有工具调用时 answerStart===0,不出现折叠行,详见 AssistantSteps.tsx)
  const { answerStart, partsCount } = useAnswerBoundary();
  // 工具因等待沙箱审批而挂起时,流会**正常结束**(非报错),若照常显示"任务已完成"
  // 会与下方"等待你的决定"的弹窗自相矛盾(2026-09-17 用户反馈)。
  // 只对最后一条消息生效,历史消息不受影响。
  const isLast = useAuiState((s: { message: { isLast: boolean } }) => s.message.isLast);
  const pendingApprovals = usePendingApprovalCards();
  const waitingApproval = isLast && pendingApprovals.some(a => a.toolName !== 'ask_user');
  const hasProcessSteps = useHasProcessSteps();
  // 流式过程中的实时阶段词(与输入框上方状态行同一推导函数)
  const streamingPhaseLabel = useAuiState((s: {
    message: { parts: readonly { type: string; result?: unknown }[] };
  }) => computePhaseLabel(s.message.parts));

  return (
    <div className="msg msg-assistant">
      {isStreaming ? (
        <>
          {hasProcessSteps && (
            <StepsFold
              answerStart={answerStart}
              isStreaming={true}
              // 过程中摘要行显示实时阶段词(正在思考/正在执行命令…),完成后才显示"任务已完成"
              label={streamingPhaseLabel}
            />
          )}
          <AnswerParts answerStart={answerStart} partsCount={partsCount} />
        </>
      ) : (
        <>
          {hasProcessSteps && (
            <StepsFold
              answerStart={answerStart}
              isStreaming={false}
              label={waitingApproval ? '等待你的授权' : undefined}
            />
          )}
          {answerStart === 0 && waitingApproval && (
            <div className="msg-steps-label">等待你的授权</div>
          )}
          <AnswerParts answerStart={answerStart} partsCount={partsCount} />
        </>
      )}
      <div className="msg-footer">
        <MessageStats />
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <ActionBarPrimitive.Copy className="msg-action-btn" title="复制">
            <CopyIcon />
          </ActionBarPrimitive.Copy>
          {/* 原生 Reload:内部走 message.reload() → AI SDK regenerate,
              请求带 trigger=regenerate-message,服务端据此替换而非追加。
              onClick 先于 reload 执行(createActionButton 用 composeEventHandlers 组合,
              自定义 handler 在前),因此能在流式开始前记下待删除的旧消息 id。 */}
          <ActionBarPrimitive.Reload
            className="msg-action-btn"
            title="重新生成"
            onClick={() => {
              // 重新生成:计时归零重新开始(不继承旧记录的 pausedMs/endMs),
              // 并清掉可能残留的"审批后续跑中"状态,避免标签误显示"正在执行"
              const tid = threadCtxForTiming?.threadId ?? '';
              restartTiming(tid, assistantIndexForTiming, messageId);
              clearThreadResuming(tid);
              onRegenerateStart(messageId);
            }}
          >
            <RegenerateIcon />
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
    </div>
  );
}

// 上下文用量环形进度指示器(12-14px,起点在12点方向)
function ContextRing({ percentage, stroke }: { percentage: number; stroke: string }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, Math.max(0, percentage)) / 100);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r={r} fill="none" stroke="#e5e5e7" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 7 7)"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  );
}
// 审批弹窗(2026-09-17 用户定向):沙箱提权/删除类审批以待决弹窗形式
// **覆盖在输入框上方**,像 CLI 工具的权限确认框,而不是埋在消息流里。
//
// 数据源双路合并(键去重):
// 1. 实时流部件(立即可见,但**不落库** —— TaskPage 每 3s 轮询历史,消息数一变
//    就重挂载,流部件随之丢失 → 这就是"弹窗闪一下就消失"的原因)
// 2. 后端待决列表轮询(GET /sandbox/approvals,权威且跨重挂载/刷新存活)
function ApprovalOverlay() {
  const threadCtx = useContext(ThreadContext);
  const onDecisionAccepted = useContext(ApprovalContext);
  const threadId = threadCtx?.threadId ?? '';
  // 待决审批统一由 ChatThread 轮询并经 Context 下发(见 usePendingApprovalCards),
  // 弹窗与"任务已完成"折叠行共用同一数据源,不会各说各话
  const approvals = usePendingApprovalCards();
  // ask_user 型挂起由右侧「问题」标签处理,不渲染成"允许该操作?"审批卡
  const actionableApprovals = approvals.filter(a => !CUSTOM_PANEL_TOOL_NAMES.has(a.toolName));
  if (actionableApprovals.length === 0) return null;
  return (
    <div className="approval-overlay">
      {actionableApprovals.map(a => (
        <SandboxApprovalCard
          key={`${a.runId}-${a.toolCallId}`}
          data={a}
          threadId={threadId}
          onDecisionAccepted={onDecisionAccepted}
        />
      ))}
    </div>
  );
}

// 待决审批轮询钩子:后端列表是权威数据源(跨重挂载/刷新存活)
function usePolledApprovals(threadId: string): ApprovalCardData[] {
  const [polled, setPolled] = useState<ApprovalCardData[]>([]);
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/sandbox/approvals?threadId=${encodeURIComponent(threadId)}`);
        if (!res.ok || !alive) return;
        const data = (await res.json()) as {
          approvals?: Array<{
            runId: string;
            toolCallId: string;
            toolName: string;
            kind: 'approval' | 'suspended';
            args?: unknown;
            payload?: unknown;
          }>;
        };
        if (!alive) return;
        setPolled(
          (data.approvals ?? []).map(a =>
            a.kind === 'suspended'
              ? {
                  state: 'data-tool-call-suspended' as const,
                  runId: a.runId,
                  toolCallId: a.toolCallId,
                  toolName: a.toolName,
                  suspendPayload: (a.payload as Record<string, unknown>) ?? {},
                }
              : {
                  state: 'data-tool-call-approval' as const,
                  runId: a.runId,
                  toolCallId: a.toolCallId,
                  toolName: a.toolName,
                  args: a.args,
                },
          ),
        );
      } catch {
        // 后端未启动等:静默
      }
    };
    void load();
    const timer = setInterval(load, 3_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);
  return polled;
}

// 任务对话主视图
// 上下文指示器:仅有会话消息时显示真实用量;压缩按钮调用后端摘要并清理旧消息
export function ChatThread({
  threadId,
  runtime,
  attachments,
  model,
  onModelChange,
  onRegenerateStart = () => {},
  onDecisionAccepted = () => {},
  onOpenPicker,
  onRemoveAttachment,
  onAttachmentsConsumed,
  skill,
  onSkillChange,
  compact = false,
  onSuspendPending,
}: {
  threadId: string;
  runtime: AssistantRuntime;
  attachments: PickedAttachment[];
  model: string;
  onModelChange: (id: string) => void;
  onOpenPicker: () => void;
  onRemoveAttachment: (id: string) => void;
  onAttachmentsConsumed: () => void;
  // M10:手动指定的技能(随请求进 requestContext.skill)
  skill?: string | null;
  onSkillChange?: (next: string | null) => void;
  onRegenerateStart?: (messageId: string) => void;
  onDecisionAccepted?: () => void;
  compact?: boolean;
  // M15:检测到 ask_user 挂起时通知父组件——ask_user 的问题表单渲染在右侧
  // PreviewPanel 的「问题」标签里,而 PreviewPanel 只在 previewOpen 时才挂载,
  // 用户没手动展开预览栏时,PreviewPanel 内部"自动打开问题标签"的逻辑根本
  // 没机会运行,导致模型在等回答、用户却看不到任何表单(2026-09-20 用户实测发现)。
  onSuspendPending?: (toolName: string, runId: string) => void;
}) {
  const [input, setInput] = useState('');
  const [ctxUsage, setCtxUsage] = useState<ContextUsage | null>(null);
  const [ctxTooltip, setCtxTooltip] = useState(false);
  const [compressing, setCompressing] = useState(false);
  // 压缩成功/失败的轻提示(2026-09-20 用户反馈:点击压缩后失败/消息太少等情况完全无反馈,
  // 像没生效;之前 catch 块是空的,result.ok 为 false 时也什么都不做)
  const [compressHint, setCompressHint] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  // 底部计时条的实时耗时(秒,一位小数,如 7.8)
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [progressLabel, setProgressLabel] = useState('处理中...');
  const [isRunning, setIsRunning] = useState(false);
  const runStartRef = useRef<number | null>(null);
  // 待决审批统一在此轮询一次,经 Context 下发给弹窗与消息折叠行(避免各自轮询)
  const polledApprovals = usePolledApprovals(threadId);
  // M16:检测到新的自定义面板类挂起(ask_user/enter_design_plan)就通知父组件展开预览栏。
  // 只在 runId 首次出现时通知一次,避免每次轮询命中都重复触发展开动作。
  const notifiedAskUserRunsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of polledApprovals) {
      if (!CUSTOM_PANEL_TOOL_NAMES.has(a.toolName)) continue;
      if (notifiedAskUserRunsRef.current.has(a.runId)) continue;
      notifiedAskUserRunsRef.current.add(a.runId);
      onSuspendPending?.(a.toolName, a.runId);
    }
  }, [polledApprovals, onSuspendPending]);
  const composer = runtime.thread.composer;
  // 斜杠技能菜单:输入「/」触发(D3)
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [skillChip, setSkillChip] = useState<{ name: string; nameZh?: string; icon: string } | null>(null);
  const slash = useSlashSkills({
    textareaRef: chatTextareaRef,
    value: input,
    setText: setInput,
    onPick: (name, meta) => {
      setSkillChip({ name, nameZh: meta?.nameZh, icon: meta?.icon ?? '🧩' });
      onSkillChange?.(name);
    },
  });

  // 自行统计每条 assistant 消息的耗时与 token(不依赖库的 metadata.timing)
  const pendingStartMsRef = useRef<number | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  // 运行开始那一刻已存在的 assistant 消息 id;之后新出现的那条即本轮回复
  const knownAssistantIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let prevRunning = false;
    return runtime.thread.subscribe(() => {
      const state = runtime.thread.getState();
      const isRunning = state.isRunning;
      const messages = state.messages;
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

      if (!prevRunning && isRunning) {
        // 组件可能在流式途中因 TaskPage 的 key 变化而重挂载:此时最后一条 assistant
        // 已有"进行中"的记录(有 startMs、无 endMs),直接接管,不要重新计时。
        const inFlight = lastAssistant
          ? lookupTiming(threadId, messages, lastAssistant.id)
          : undefined;
        if (inFlight?.startMs != null && inFlight.endMs == null) {
          streamingMsgIdRef.current = lastAssistant!.id;
        } else {
          // 正常开始:快照此刻已存在的 assistant id,并暂存开始时间等待绑定。
          // 用快照而非"是否已有记录"来判断新旧 —— 后者在"同一会话发第二条消息"
          // (上一条回复已有记录)和"刷新后发消息"(历史消息都没记录)两种场景下都会判错。
          knownAssistantIdsRef.current = new Set(
            messages.filter(m => m.role === 'assistant').map(m => m.id),
          );
          pendingStartMsRef.current = Date.now();
          streamingMsgIdRef.current = null;
        }
      }

      // 绑定:找出快照之外的那条 assistant 消息(即本轮回复的占位),把开始时间给它
      if (pendingStartMsRef.current != null) {
        const fresh = messages.find(
          m => m.role === 'assistant' && !knownAssistantIdsRef.current.has(m.id),
        );
        if (fresh) {
          const record: TimingRecord = { startMs: pendingStartMsRef.current };
          timingStore.set(fresh.id, record);
          const index = getAssistantIndex(messages, fresh.id);
          if (index >= 0) timingStore.set(`${threadId}#${index}`, record);
          streamingMsgIdRef.current = fresh.id;
          pendingStartMsRef.current = null;
        }
      }

      // 运行结束:不能用 prevRunning 做"由 true 转 false"的边沿检测 ——
      // prevRunning 是 effect 闭包内的局部变量,而 TaskPage 的 key 含消息数,
      // 新回复落库后组件重挂载、effect 重建、prevRunning 归零,那个边沿永远等不到,
      // endMs 写不进去,前端计时器就会一直跑下去。
      // 改为状态判断:只要当前空闲且存在"进行中"的记录(有 startMs 无 endMs),就补上 endMs。
      //
      // 注:挂起等待审批时流也会正常结束,这里照常写入 endMs(记录"挂起那一刻")。
      // 授权后的"计时继续"由 MessageStats 依据续跑状态计算,不在此处改动记录 ——
      // endMs 必须保留,它是扣除"等待授权时长"的基准点。
      if (!isRunning) {
        const candidateId = streamingMsgIdRef.current ?? lastAssistant?.id;
        const record = candidateId ? lookupTiming(threadId, messages, candidateId) : undefined;
        if (record?.startMs != null && record.endMs == null) record.endMs = Date.now();
        streamingMsgIdRef.current = null;
        pendingStartMsRef.current = null;
      }

      prevRunning = isRunning;
    });
  }, [runtime, threadId]);

  // 单独 200ms 轮询:上面那个上下文用量的 interval 是 1s,粒度不够显示一位小数
  // 顺带更新进度条文案(从最后一条 assistant 的 parts 推断阶段)
  useEffect(() => {
    const interval = setInterval(() => {
      const state = runtime.thread.getState();
      const running = state.isRunning;
      setIsRunning(running);
      if (running) {
        if (runStartRef.current == null) runStartRef.current = Date.now();
        setLiveElapsed((Date.now() - runStartRef.current) / 1000);

        const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant');
        const parts = (lastAssistant?.content ?? []) as readonly import('./AssistantSteps').PartLike[];
        setProgressLabel(computePhaseLabel(parts));
      } else if (polledApprovals.length === 0) {
        runStartRef.current = null;
      }
    }, 200);
    return () => clearInterval(interval);
  }, [runtime, polledApprovals.length]);

  // 上下文用量:消息数变化时从后端拉取
  useEffect(() => {
    const interval = setInterval(() => {
      const count = runtime.thread.getState().messages.length;
      setMsgCount(prev => {
        if (prev !== count) {
          void getContextUsage(threadId).then(setCtxUsage).catch(() => {});
          return count;
        }
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [runtime, threadId]);

  // BrowserPreview "交给 agent" 按钮:把当前网页内容填充到输入框，但不自动发送。
  useEffect(() => {
    const handleFillComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ title: string; url: string; text: string }>).detail;
      if (!detail) return;
      const { title, url, text } = detail;
      const snippet = `以下是我正在浏览的网页，请帮我分析:
标题:${title}
网址:${url}

${text}`;
      const current = composer.getState().text;
      const next = current ? current + '\n\n' + snippet : snippet;
      composer.setText(next);
      setInput(next);
      document.querySelector<HTMLTextAreaElement>('.chat-composer-input')?.focus();
    };
    window.addEventListener('h0-fill-composer', handleFillComposer);
    return () => window.removeEventListener('h0-fill-composer', handleFillComposer);
  }, [composer]);

  const handleCompress = async () => {
    if (compressing) return;
    if (!window.confirm('压缩会把早期消息摘要成一条【历史摘要】并永久删除原始消息(保留最近 2 条),不可撤销。确定继续?')) return;
    setCompressing(true);
    setCompressHint(null);
    try {
      const result = await compressContext(threadId);
      if (result.ok) {
        void getContextUsage(threadId).then(setCtxUsage).catch(() => {});
        // 显示压缩前后的真实 token 变化:只报"删除了几条"会掩盖
        // "删了消息但 token 几乎没降"(保留消息里混着巨型工具结果)的情况
        const before = result.tokensBefore;
        const after = result.tokensAfter;
        const tokenInfo =
          typeof before === 'number' && typeof after === 'number'
            ? `，token ${before} → ${after}`
            : '';
        setCompressHint(`已压缩,删除了 ${result.deletedCount ?? 0} 条历史消息${tokenInfo}`);
      } else {
        // 常见原因:消息数 < 4 条(后端硬性门槛),或模型摘要生成/写回失败
        setCompressHint(result.reason ?? '压缩失败,请稍后重试');
      }
    } catch (err) {
      setCompressHint(err instanceof Error ? `压缩失败: ${err.message}` : '压缩失败,请检查网络后重试');
    } finally {
      setCompressing(false);
      setTimeout(() => setCompressHint(null), 4000);
    }
  };

  const handleSend = () => {
    if (runtime.thread.getState().isRunning) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const section = attachments.length > 0 ? `\n\n${attachmentSection(attachments)}` : '';
    composer.setText(text + section);
    composer.send();
    composer.setText('');
    setInput('');
    if (attachments.length > 0) onAttachmentsConsumed();
    // M10:技能只随本条消息携带,发送后清除标签(requestContext 已在 send 时读到)
    onSkillChange?.(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = msgCount > 0 && ctxUsage != null;
  const ctxStrokeColor = ctxUsage != null
    ? ctxUsage.percentage > 80
      ? '#ef4444'
      : ctxUsage.percentage > 50
        ? '#d97706'
        : '#9a9aa2'
    : '#9a9aa2';
  const ctxPercentage = ctxUsage?.percentage ?? 0;

  return (
    <RegenerateContext.Provider value={onRegenerateStart}>
    <ApprovalContext.Provider value={onDecisionAccepted}>
    <ThreadContext.Provider value={{ threadId }}>
    <RoleArtifactTypeContext.Provider value={getRole(useWorkbenchStore(state => state.roleOf(threadId))).artifactType}>
    <PolledApprovalsContext.Provider value={polledApprovals}>
    <ThreadPrimitive.Root className="chat-root">
      <ThreadPrimitive.Viewport autoScroll className="chat-viewport">
        <ThreadPrimitive.If empty>
          <div className="chat-welcome">这是你的任务空间,描述一个任务开始吧</div>
        </ThreadPrimitive.If>
        <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
      </ThreadPrimitive.Viewport>

      <div className="chat-composer-area">
        {/* 运行中或等待授权时显示整体进度条(输入框上方):中间步骤已折叠进消息内,这里只报总耗时 */}
        {(isRunning || polledApprovals.length > 0) && (
          <div className="chat-progress-bar">
            <span className="tool-card-spinner" />
            <span className="chat-progress-label">
              {(() => {
              if (polledApprovals.some(a => a.toolName !== 'ask_user')) return '等待你的授权…';
              if (polledApprovals.some(a => a.toolName === 'ask_user')) return '等待你的回答…';
              return progressLabel;
            })()}
            </span>
            <span className="chat-progress-time">{liveElapsed.toFixed(1)}s</span>
          </div>
        )}
        {/* 沙箱审批弹窗:覆盖在输入框上方,等待用户决定 */}
        <ApprovalOverlay />
        <div className="chat-composer">
          {attachments.length > 0 && (
            <AttachmentBar attachments={attachments} onRemove={onRemoveAttachment} />
          )}
          <textarea
            ref={chatTextareaRef}
            className="chat-composer-input"
            placeholder="描述任务，输入/调用技能"
            rows={1}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              slash.handleInput();
            }}
            onKeyDown={e => {
              if (slash.handleKeyDown(e)) return;
              handleKeyDown(e);
            }}
          />
          {slash.open && (
            <SlashSkillMenu items={slash.items} selIndex={slash.selIndex} listRef={slash.listRef} onPick={slash.pick} />
          )}
          {/* toolbar 是 space-between 布局:必须保留 left/right 两个分组容器,
              否则子元素会被均匀撑开(圆点贴左、模型选择器居中、发送贴右) */}
          <div className={`chat-composer-toolbar${compact ? ' is-compact' : ''}`}>
            <div className="chat-composer-left">
            <button type="button" className="task-input-plus" title="添加附件" onClick={onOpenPicker}>
              +
            </button>
            {skillChip && (
              <span className="skill-chip" title={`后续消息使用技能:${skillChip.nameZh ?? skillChip.name}`}>
                <span className="skill-chip-icon">{skillChip.icon}</span>
                <span className="skill-chip-name">{skillChip.nameZh ?? skillChip.name}</span>
                <button
                  type="button"
                  className="skill-chip-remove"
                  title="移除技能"
                  onClick={() => {
                    setSkillChip(null);
                    onSkillChange?.(null);
                  }}
                >
                  ×
                </button>
              </span>
            )}
            <RoleSelector threadId={threadId} messagesCount={runtime.thread.getState().messages.length} />
            <ConnectorPicker />
            {!compact && <PermissionSelect />}
            </div>
            <div className="chat-composer-right">
            {/* 上下文用量圆点紧贴模型选择器左侧(紧凑模式隐藏) */}
            {hasMessages && !compact && (
              <div className="ctx-indicator">
                <button
                  type="button"
                  className="ctx-dot"
                  title={`上下文用量 ${ctxPercentage}%`}
                  onClick={() => setCtxTooltip(v => !v)}
                >
                  <ContextRing percentage={ctxPercentage} stroke={ctxStrokeColor} />
                </button>
                {ctxTooltip && ctxUsage && (
                  <>
                    <div className="model-menu-backdrop" onClick={() => setCtxTooltip(false)} />
                    <div className="ctx-tooltip" onClick={e => e.stopPropagation()}>
                      <div className="ctx-tooltip-title">
                        上下文窗口：{ctxUsage.percentage}%
                      </div>
                      <div className="ctx-tooltip-desc">
                        展示当前对话的上下文占用情况；压缩会摘要早期内容，需等待片刻并消耗少量积分。
                      </div>
                      <div className="ctx-tooltip-bar">
                        <span style={{ width: `${ctxUsage.percentage}%` }} />
                      </div>
                      <button
                        type="button"
                        className="ctx-tooltip-btn"
                        onClick={() => void handleCompress()}
                        disabled={compressing}
                      >
                        {compressing ? '压缩中…' : '⧉ 压缩上下文'}
                      </button>
                      {compressHint && <div className="ctx-tooltip-hint">{compressHint}</div>}
                    </div>
                  </>
                )}
              </div>
            )}
            <ModelSelect model={model} onModelChange={onModelChange} compact={compact} />
            <button type="button" className="task-input-circle" title="语音输入">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
            {/* 运行中显示圆形停止按钮,空闲显示圆形发送按钮 */}
            <ThreadPrimitive.If running>
              <button type="button" className="chat-btn-stop-circle" onClick={() => composer.cancel()}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" />
                </svg>
              </button>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <button
                type="button"
                className="task-input-send-circle"
                title="发送"
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
              >
                ↑
              </button>
            </ThreadPrimitive.If>
            </div>
          </div>
        </div>
      </div>
    </ThreadPrimitive.Root>
    </PolledApprovalsContext.Provider>
    </RoleArtifactTypeContext.Provider>
    </ThreadContext.Provider>
    </ApprovalContext.Provider>
    </RegenerateContext.Provider>
  );
}
