// 设计计划确认工具(M16-T1):design 角色在开始生成产物前,先提交一份设计计划
// 供用户确认。复用 ask_user 同构的 suspend/resume 挂起机制。
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const artifactPlanSchema = z.object({
  path: z.string().describe('计划产出的文件名(仅用于展示,不是真实工作区路径,因为 design 产物走 <artifact> 标签不落盘)'),
  purpose: z.string().describe('这个文件承担什么作用'),
});

const designPlanSchema = z.object({
  abstract: z.string().describe('给用户看的执行摘要,3-6 句话说明设计方向与关键决策'),
  artifacts: z.array(artifactPlanSchema).min(1).describe('计划产出的文件列表'),
});

export const enterDesignPlanTool = createTool({
  id: 'enter_design_plan',
  description:
    '提交一份设计计划供用户确认,再开始真正生成产物。当已经通过 ask_user 澄清需求、' +
    '准备动手设计页面之前调用一次。用户确认后(approved)按计划继续;' +
    '用户选择跳过规划(direct)时直接开始生成,不必重新调用本工具;' +
    '用户要求修改计划(revise)时,根据 feedback 调整后重新调用本工具再提交一次。',
  inputSchema: z.object({ plan: designPlanSchema }),
  outputSchema: z.object({
    decision: z.enum(['approved', 'direct', 'revise']),
    feedback: z.string().optional(),
    note: z.string().optional(),
  }),
  suspendSchema: z.object({ plan: designPlanSchema }),
  resumeSchema: z.object({
    decision: z.enum(['approved', 'direct', 'revise']),
    feedback: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend } = ((context as { agent?: unknown }).agent as
      | {
          resumeData?: { decision?: 'approved' | 'direct' | 'revise'; feedback?: string };
          suspend?: (payload: { plan: typeof input.plan }) => Promise<{
            decision: 'approved' | 'direct' | 'revise';
            feedback?: string;
          }>;
        }
      | undefined) ?? {};

    // 与 ask-user.ts 相同的显式校验:缺 suspend 会静默吞掉挂起,
    // 工具返回 undefined,agent 误以为成功。
    if (typeof suspend !== 'function') {
      throw new Error('enter_design_plan 工具运行时上下文异常:缺少 suspend 能力');
    }

    // 首次执行:挂起等待用户确认(suspend 调用后必须立即 return)
    if (resumeData == null) {
      return await suspend({ plan: input.plan });
    }

    // 恢复执行:用户已做出决定
    if (resumeData.decision === 'direct') {
      return {
        decision: 'direct' as const,
        note: '用户选择跳过规划、直接执行,按你提交的计划(或你认为最合理的方案)直接开始生成产物,不要再等待额外确认。',
      };
    }
    if (resumeData.decision === 'revise') {
      return {
        decision: 'revise' as const,
        feedback: resumeData.feedback,
        note: `用户要求修改计划,反馈如下:${resumeData.feedback ?? '(未填写具体意见)'}。请根据反馈调整计划后重新调用 enter_design_plan 提交。`,
      };
    }
    return {
      decision: 'approved' as const,
      note: '用户已确认计划,请严格按提交的计划继续生成产物。',
    };
  },
});
