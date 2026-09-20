// 沙箱审批辅助服务(M11-T13):进程内状态,不落盘。
//
// 本模块只维护框架没有的三件事:权限档位解析、拒绝计数熔断、会话批准集。
// 待决审批本身的存储/发现由框架 agent.listSuspendedRuns 负责(挂起快照存在 LibSQL),
// 不在此处管理。
//
// 注意:全部状态进程内、重启即失;跨重启的待决审批一律视为拒绝(框架侧持久化
// 的挂起快照是否恢复由框架决定,本模块只负责自己会话级缓存的失效)。

import type { PermissionTier } from './sandbox-runtime';

/** 供审批路由使用的本地用户资源标识 */
export const LOCAL_USER_RESOURCE = 'local-user';

/** 拒绝计数条目 */
interface DenialRecord {
  count: number;
  lastHitAt: number;
}

// 拒绝计数: key -> { count, lastHitAt }
const denialMap = new Map<string, DenialRecord>();
// 会话批准集: threadId -> Set<key>
const sessionApprovalMap = new Map<string, Set<string>>();

/** 拒绝计数 TTL:30 分钟内无命中即清除(惰性清扫) */
const DENIAL_TTL_MS = 30 * 60 * 1000;

/** 熔断阈值:同一 key 被拒绝 2 次后不再打扰用户 */
const DENIAL_EXHAUSTED_THRESHOLD = 2;

/** 惰性清扫过期拒绝计数 */
function sweepDenials(): void {
  const now = Date.now();
  for (const [key, rec] of denialMap) {
    if (now - rec.lastHitAt > DENIAL_TTL_MS) {
      denialMap.delete(key);
    }
  }
}

/**
 * 从请求上下文中解析权限档位。
 *
 * 仅接受 'default' | 'full',其他一律返回 'default'(fail-closed)。
 * 本任务只导出,不接线(T15 接入 CodexSandbox.resolveTier)。
 */
export function resolveTier(requestContext: unknown): PermissionTier {
  if (requestContext == null) return 'default';
  // 框架运行时传入的是 RequestContext 类实例:值存于内部 registry,'permission' 是
  // 运行时键(非 schema 声明),文档要求用 getRaw 读取;get 可能只回声明键。
  // 测试/其他调用方可能传 Map 或普通对象 —— 各形态都兜住。
  const rc = requestContext as {
    getRaw?: (key: string) => unknown;
    get?: (key: string) => unknown;
    permission?: unknown;
  };
  let raw: unknown;
  if (typeof rc.getRaw === 'function') {
    raw = rc.getRaw('permission');
  } else if (typeof rc.get === 'function' && !(requestContext instanceof Map)) {
    raw = rc.get('permission');
  } else if (requestContext instanceof Map) {
    raw = requestContext.get('permission');
  } else {
    raw = rc.permission;
  }
  if (raw === 'full') return 'full';
  return 'default';
}

/**
 * 记录一次明确拒绝(挂起请求不计,只有用户点了拒绝才计),并返回是否已熔断。
 *
 * 按会话隔离:threadId 参与键构造 —— A 会话的拒绝不影响 B 会话的询问(2026-09-17
 * 用户实测反馈:进程级计数导致 B 会话永远收不到审批弹窗)。
 * 达到 DENIAL_EXHAUSTED_THRESHOLD(2)后,同一会话内同类提权直接返回 denied,不再挂起打扰。
 */
export function recordDenial(threadId: string, key: string): { count: number; exhausted: boolean } {
  return recordDenialInternal(compositeDenialKey(threadId, key));
}

// ── 已决定审批的抑制表 ────────────────────────────────────────────────
// 决定后路由**立即返回**(续跑转后台),此时框架的挂起快照还没被清除,
// listSuspendedRuns 仍会报告它 → 前端轮询会把刚处理掉的弹窗又弹回来
// (2026-09-17 用户实测:"消失马上又弹")。这里记一笔"已决定",
// 让待决列表把它过滤掉;续跑完成后快照自然消失,标记按 TTL 过期。
const decidedMap = new Map<string, number>();
const DECIDED_TTL_MS = 10 * 60 * 1000;

function decidedKey(runId: string, toolCallId: string): string {
  return `${runId}|${toolCallId}`;
}

function sweepDecided(): void {
  const now = Date.now();
  for (const [key, at] of decidedMap) {
    if (now - at > DECIDED_TTL_MS) decidedMap.delete(key);
  }
}

/** 标记某审批已被决定(批准或拒绝),用于过滤待决列表 */
export function markApprovalDecided(runId: string, toolCallId: string): void {
  sweepDecided();
  decidedMap.set(decidedKey(runId, toolCallId), Date.now());
}

/** 该审批是否已被决定(决定后快照未即时清除期间用于过滤) */
export function isApprovalDecided(runId: string, toolCallId: string): boolean {
  sweepDecided();
  return decidedMap.has(decidedKey(runId, toolCallId));
}

/**
 * 撤销"已决定"标记。
 * 决定执行失败(返回 500)时必须调用 —— 否则该审批既没被真正处理,又从待决列表
 * 消失了,用户无法重试,agent 运行永久挂着(静默卡死)。
 */
export function unmarkApprovalDecided(runId: string, toolCallId: string): void {
  decidedMap.delete(decidedKey(runId, toolCallId));
}

/** 只读查询:该会话内同类提权是否已熔断(不计数) */
export function denialExhausted(threadId: string, key: string): boolean {
  sweepDenials();
  const rec = denialMap.get(compositeDenialKey(threadId, key));
  return (rec?.count ?? 0) >= DENIAL_EXHAUSTED_THRESHOLD;
}

function compositeDenialKey(threadId: string, key: string): string {
  return `${threadId}|${key}`;
}

function recordDenialInternal(composite: string): { count: number; exhausted: boolean } {
  sweepDenials();
  const now = Date.now();
  const rec = denialMap.get(composite);
  if (!rec) {
    denialMap.set(composite, { count: 1, lastHitAt: now });
    return { count: 1, exhausted: false };
  }
  rec.count += 1;
  rec.lastHitAt = now;
  return { count: rec.count, exhausted: rec.count >= DENIAL_EXHAUSTED_THRESHOLD };
}

/** 判断某会话是否已批准过指定 key */
export function isSessionApproved(threadId: string, key: string): boolean {
  return sessionApprovalMap.get(threadId)?.has(key) ?? false;
}

/** 把指定 key 加入会话批准集 */
export function approveSession(threadId: string, key: string): void {
  let set = sessionApprovalMap.get(threadId);
  if (!set) {
    set = new Set<string>();
    sessionApprovalMap.set(threadId, set);
  }
  set.add(key);
}

/**
 * 把被拒命令归一化为会话批准键。
 *
 * 取命令第一个 token(可执行名,小写、去引号) + 目标路径的盘符,
 * 例如 mkdir + E: -> "mkdir|E:"。
 *
 * 这是粗粒度设计:同类同盘符的提权在会话内复用一次批准,避免用户每行命令
 * 都被询问,同时不把范围放大到整个会话或整个磁盘。
 */
export function elevationKey(command: string): string {
  const trimmed = command.trim();
  let first = trimmed.split(/\s+/)[0] ?? '';
  // 去掉首尾引号(如 ".\"path with spaces\"")
  first = first.replace(/^['"/]+|['"/]+$/g, '').toLowerCase();
  // 可执行名只取 basename(去掉路径前缀),避免不同目录下同程序产生不同 key
  first = first.replace(/^.*[\\/]/, '');

  // 尝试从命令串里找第一个绝对路径的盘符
  const match = trimmed.match(/([a-zA-Z]:)/);
  const drive = match ? match[1].toUpperCase() : '';
  return drive ? `${first}|${drive}` : first;
}
