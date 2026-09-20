// 沙箱审批路由(M11-T14):列出待决审批并接收前端决定。
//
// 决定后前端通过既有线程历史接口重载消息;续跑的 LLM 生成与工具调用由服务端在
// drain 恢复流的过程中完成并写入记忆,本次 HTTP 响应只返回 { ok: true }。

import { registerApiRoute } from '@mastra/core/server';
import { agent } from '../agents/agent';
import {
  approveSession,
  elevationKey,
  isApprovalDecided,
  markApprovalDecided,
  unmarkApprovalDecided,
  LOCAL_USER_RESOURCE,
} from '../services/sandbox-approval';

// 从挂起 run 中拆出工具调用列表,统一为审批卡片可用的结构
interface ApprovalItem {
  runId: string;
  toolCallId: string;
  toolName: string;
  kind: 'approval' | 'suspended';
  args: unknown;
  payload?: unknown;
}

interface SuspendedRun {
  runId: string;
  // 框架返回的实际结构以 any 处理,避免类型版本差异
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    requiresApproval?: boolean;
    suspendPayload?: unknown;
  }>;
}

/** 消费恢复流直到结束,让续跑的生成与工具调用在服务端完成 */
async function drainStream(stream: { fullStream: AsyncIterable<{ type?: string }> }): Promise<void> {
  for await (const _chunk of stream.fullStream) {
    // 只消费,不处理单个 chunk;服务端完成续跑并写入记忆
  }
}

/** 后台消费恢复流:决定路由立即返回,续跑在后台完成 */
function drainInBackground<T>(stream: { fullStream: AsyncIterable<T> }, label: string): void {
  void drainStream(stream as { fullStream: AsyncIterable<{ type?: string }> }).catch(err => {
    console.error(`[${label}] 续跑流后台消费失败`, err);
  });
}

export const approvalRoutes = [
  // GET /sandbox/approvals?threadId=: 列出当前 thread 的待决审批
  registerApiRoute('/sandbox/approvals', {
    method: 'GET',
    handler: async c => {
      const threadId = c.req.query('threadId');
      if (!threadId) {
        return c.json({ error: '缺少 threadId 参数' }, 400);
      }

      // 框架返回 { runs, total },这里解构取 runs
      const { runs } = (await (agent as any).listSuspendedRuns({
        threadId,
        resourceId: LOCAL_USER_RESOURCE,
      })) as { runs?: SuspendedRun[] };

      const approvals: ApprovalItem[] = [];
      for (const run of runs ?? []) {
        for (const toolCall of run.toolCalls ?? []) {
          // 已决定但快照尚未清除的:过滤掉,否则前端轮询会把刚处理掉的弹窗又弹回来
          if (isApprovalDecided(run.runId, toolCall.toolCallId)) continue;
          const kind = toolCall.requiresApproval ? 'approval' : 'suspended';
          approvals.push({
            runId: run.runId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            kind,
            args: toolCall.args,
            payload: kind === 'suspended' ? toolCall.suspendPayload : undefined,
          });
        }
      }

      return c.json({ approvals });
    },
  }),

  // POST /sandbox/approvals/:runId: 对指定 run 做出批准/拒绝决定
  registerApiRoute('/sandbox/approvals/:runId', {
    method: 'POST',
    handler: async c => {
      const runId = c.req.param('runId');
      let body: {
        threadId?: string;
        toolCallId?: string;
        decision?: unknown;
        mode?: string;
        reason?: string;
      };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: '请求体 JSON 解析失败' }, 400);
      }

      const { threadId, toolCallId, decision, mode, reason } = body;

      if (!threadId || !toolCallId) {
        return c.json({ error: '缺少 threadId 或 toolCallId 参数' }, 400);
      }
      if (decision !== 'approved' && decision !== 'declined') {
        return c.json({ error: 'decision 必须是 approved 或 declined' }, 400);
      }

      // 重新查询挂起 run,确认它仍存在并定位 toolCall
      const { runs } = (await (agent as any).listSuspendedRuns({
        threadId,
        resourceId: LOCAL_USER_RESOURCE,
      })) as { runs?: SuspendedRun[] };
      const run = (runs ?? []).find(r => r.runId === runId);
      if (!run) {
        return c.json({ error: '未找到该审批请求(可能已处理或已过期)' }, 404);
      }
      const toolCall = (run.toolCalls ?? []).find(t => t.toolCallId === toolCallId);
      if (!toolCall) {
        return c.json({ error: '未找到该审批请求(可能已处理或已过期)' }, 404);
      }

      const approved = decision === 'approved';
      // 先落"已决定"标记再执行:决定后本路由立即返回,而框架挂起快照要等续跑
      // 推进才消失。没有这个标记,前端下一轮轮询会把刚处理掉的审批又弹回来。
      markApprovalDecided(runId, toolCallId);

      try {
        // ⚠️ 决定后**立即返回**,续跑转后台消费(2026-09-17 用户反馈:点击后弹窗
        // 半天不消失)。之前 await 整个续跑流,等于让用户等模型把后续全部生成完。
        // 续跑结果写入 memory,前端靠既有的历史轮询逐步显示。
        // drainInBackground 已提取到模块级
        if (toolCall.requiresApproval) {
          // requireApproval 型:框架 approveToolCall / declineToolCall
          if (approved) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stream = await (agent as any).approveToolCall({ runId, toolCallId });
            drainInBackground(stream, '审批');
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const stream = await (agent as any).declineToolCall({
              runId,
              toolCallId,
              reason: reason ?? '用户拒绝',
            });
            drainInBackground(stream, '审批');
          }
        } else {
          // suspend 型:框架 resumeStream
          const stream = await (agent as any).resumeStream(
            { approved },
            { runId },
          );
          drainInBackground(stream, '审批');

          // 若前端选择"会话内允许",把该命令 key 加入会话批准集
          if (approved && mode === 'session') {
            const payload = toolCall.suspendPayload as
              | { command?: string }
              | undefined;
            if (payload?.command) {
              approveSession(threadId, elevationKey(payload.command));
            }
          }
        }
      } catch (err) {
        // 失败必须撤销"已决定"标记:否则该审批既没被处理,又从待决列表消失,
        // 用户无法重试、agent 运行静默卡死。
        unmarkApprovalDecided(runId, toolCallId);
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: `审批决定处理失败:${message}` }, 500);
      }

      return c.json({ ok: true });
    },
  }),

  // POST /ask-user/answer: 提交 ask_user 的回答(或"AI 自行决定"),恢复挂起的运行流。
  // 与审批决定路由同构:先 markApprovalDecided 再 resume,失败回滚,立即返回、续跑后台 drain。
  registerApiRoute('/ask-user/answer', {
    method: 'POST',
    handler: async c => {
      let body: {
        threadId?: string;
        runId?: string;
        toolCallId?: string;
        answers?: Record<string, string | string[]>;
        skip?: boolean;
      };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: '请求体 JSON 解析失败' }, 400);
      }

      const { threadId, runId, toolCallId, answers, skip } = body;
      if (!threadId || !runId || !toolCallId) {
        return c.json({ error: '缺少 threadId、runId 或 toolCallId 参数' }, 400);
      }

      // 重新查询挂起 run,确认它仍存在并定位 toolCall
      const { runs } = (await (agent as any).listSuspendedRuns({
        threadId,
        resourceId: LOCAL_USER_RESOURCE,
      })) as { runs?: SuspendedRun[] };
      const run = (runs ?? []).find(r => r.runId === runId);
      if (!run) {
        return c.json({ error: '未找到该提问请求(可能已处理或已过期)' }, 404);
      }
      const toolCall = (run.toolCalls ?? []).find(t => t.toolCallId === toolCallId);
      if (!toolCall) {
        return c.json({ error: '未找到该提问请求(可能已处理或已过期)' }, 404);
      }
      // 安全校验:该端点只处理 ask_user 型挂起,不能用于恢复其它工具
      if (toolCall.toolName !== 'ask_user' || toolCall.requiresApproval) {
        return c.json({ error: '该挂起不是结构化提问' }, 400);
      }

      // 先落"已决定"标记再执行:决定后本路由立即返回,而框架挂起快照要等续跑
      // 推进才消失。没有这个标记,前端下一轮轮询会把刚处理掉的提问又弹回来。
      markApprovalDecided(runId, toolCallId);

      try {
        const stream = await (agent as any).resumeStream(
          { answers: answers ?? {}, skip: skip ?? false },
          { runId },
        );
        drainInBackground(stream, 'ask-user');
      } catch (err) {
        // 失败必须撤销"已决定"标记:否则该提问既没被处理,又从待决列表消失,
        // 用户无法重试、agent 运行静默卡死。
        unmarkApprovalDecided(runId, toolCallId);
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: `提问回答处理失败:${message}` }, 500);
      }

      return c.json({ ok: true });
    },
  }),
  // POST /design-plan/decide: 提交设计计划确认决定,恢复挂起的运行流。
  // 与 ask-user/answer 端点同构:先 markApprovalDecided 再 resume,失败回滚,立即返回、续跑后台 drain。
  registerApiRoute('/design-plan/decide', {
    method: 'POST',
    handler: async c => {
      let body: {
        threadId?: string;
        runId?: string;
        toolCallId?: string;
        decision?: unknown;
        feedback?: string;
      };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: '请求体 JSON 解析失败' }, 400);
      }

      const { threadId, runId, toolCallId, decision, feedback } = body;
      if (!threadId || !runId || !toolCallId) {
        return c.json({ error: '缺少 threadId、runId 或 toolCallId 参数' }, 400);
      }
      if (decision !== 'approved' && decision !== 'direct' && decision !== 'revise') {
        return c.json({ error: "decision 必须是 'approved'、'direct' 或 'revise'" }, 400);
      }

      // 重新查询挂起 run,确认它仍存在并定位 toolCall
      const { runs } = (await (agent as any).listSuspendedRuns({
        threadId,
        resourceId: LOCAL_USER_RESOURCE,
      })) as { runs?: SuspendedRun[] };
      const run = (runs ?? []).find(r => r.runId === runId);
      if (!run) {
        return c.json({ error: '未找到该设计计划请求(可能已处理或已过期)' }, 404);
      }
      const toolCall = (run.toolCalls ?? []).find(t => t.toolCallId === toolCallId);
      if (!toolCall) {
        return c.json({ error: '未找到该设计计划请求(可能已处理或已过期)' }, 404);
      }
      // 安全校验:该端点只处理 enter_design_plan 型挂起,不能用于恢复其它工具
      if (toolCall.toolName !== 'enter_design_plan' || toolCall.requiresApproval) {
        return c.json({ error: '该挂起不是设计计划确认' }, 400);
      }

      // 先落"已决定"标记再执行:决定后本路由立即返回,而框架挂起快照要等续跑
      // 推进才消失。没有这个标记,前端下一轮轮询会把刚处理掉的设计计划又弹回来。
      markApprovalDecided(runId, toolCallId);

      try {
        const stream = await (agent as any).resumeStream(
          { decision, feedback },
          { runId },
        );
        drainInBackground(stream, 'design-plan');
      } catch (err) {
        // 失败必须撤销"已决定"标记:否则该设计计划决定既没被处理,又从待决列表消失,
        // 用户无法重试、agent 运行静默卡死。
        unmarkApprovalDecided(runId, toolCallId);
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: `设计计划决定处理失败:${message}` }, 500);
      }

      return c.json({ ok: true });
    },
  }),
];
