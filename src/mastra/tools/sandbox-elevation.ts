// 沙箱提权工具(M11-T13):当命令被沙箱拒绝后,向用户申请一次性或会话级放宽。
//
// 本工具通过 agent 的 suspend/resume 机制挂起当前运行流,等待前端审批卡片决定。
// 批准后以 'workspace-write' 策略 + 'full' 档位策略选项重跑原命令,实现沙箱外
// 操作的显式授权。

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  sandboxedShellExec,
  tierPolicyOptions,
} from '../services/sandbox-runtime';
import {
  denialExhausted,
  elevationKey,
  isSessionApproved,
  recordDenial,
} from '../services/sandbox-approval';

export const requestSandboxElevationTool = createTool({
  id: 'request_sandbox_elevation',
  description:
    '当命令因沙箱策略被拒绝时,向用户申请一次性或会话级提权以重跑该命令。' +
    '仅在 execute_command 等操作明确收到沙箱拒绝后调用,不要用于普通命令。',
  inputSchema: z.object({
    command: z.string().describe('被沙箱拒绝的原命令串'),
    reason: z.string().describe('被拒原因/请求放宽的范围'),
  }),
  outputSchema: z.object({
    rerun: z.boolean().describe('是否已重跑'),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    denied: z.boolean().describe('是否因未获批准或仍被沙箱拒绝而失败'),
    note: z.string().optional().describe('给模型的执行说明(是否需要再次执行原命令)'),
  }),
  suspendSchema: z.object({
    command: z.string(),
    reason: z.string(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend, threadId } = (context as { agent?: unknown }).agent as {
      resumeData?: { approved?: boolean };
      suspend?: (payload: { command: string; reason: string }) => Promise<{ rerun: boolean; stdout?: string; stderr?: string; exitCode?: number; denied: boolean }>;
      threadId?: string;
    } ?? {};

    // 必须显式校验:若上下文未携带 suspend,可选链会静默吞掉挂起,工具返回 undefined,
    // agent 误以为成功。
    if (typeof suspend !== 'function') {
      throw new Error('沙箱提权工具运行时上下文异常:缺少 suspend 能力');
    }

    const key = elevationKey(input.command);
    const tid = threadId ?? '';
    // resume 后的执行(resumeData 存在,含 approved:false)与首次发起不同:
    // 前者说明用户刚刚对本次申请做出了决定
    const isResumePass = resumeData != null;

    if (!resumeData?.approved && !isSessionApproved(tid, key)) {
      // 已熔断(同一会话内同类请求被明确拒绝两次):不再打扰,直接如实拒绝
      if (denialExhausted(tid, key)) {
        return {
          rerun: false,
          stdout: '',
          stderr: '同类提权请求在本会话内已被拒绝两次,本次不再发起审批;请改用工作区内路径或告知用户',
          exitCode: 1,
          denied: true,
        };
      }
      // resume 回来的"拒绝"决定:计一次明确拒绝,本次直接返回 denied(不再连弹)
      // —— 累计两次拒绝后熔断,与任务书 T13 的阈值一致
      if (isResumePass) {
        recordDenial(tid, key);
        return {
          rerun: false,
          stdout: '',
          stderr: '用户拒绝了本次提权申请',
          exitCode: 1,
          denied: true,
        };
      }
      // 首次发起:挂起询问用户(挂起请求本身不计数)
      // suspend 不抛异常,调用后必须立即 return
      return await suspend({ command: input.command, reason: input.reason });
    }

        // 已获批准(本次 resume 或本会话),以 full 档位重跑原命令
    const result = await sandboxedShellExec(input.command, {
      policy: 'workspace-write',
      policyOptions: tierPolicyOptions('full'),
      timeout: 120_000,
    });

    return {
      rerun: true,
      // 明确告知模型:命令已代为执行,不要再执行一遍(非幂等命令如 >> 会重复写入)。
      // 光靠 instructions 不够可靠 —— 工具返回值就在模型眼前,提示放这里最直接。
      note:
        result.exitCode === 0
          ? '原命令已在提权后由本工具执行完毕,请直接依据 stdout 汇报结果;禁止再次执行同一命令(重复执行会导致追加类命令写入两次)。需要核对结果时只做只读校验。'
          : '原命令已在提权后执行但返回非零退出码,请依据 stderr 判断原因;不要盲目重复执行同一命令。',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      denied: result.deniedBySandbox,
    };
  },
});
