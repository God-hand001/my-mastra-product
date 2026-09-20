// 结构化提问工具(M15-T6):design/slides 角色在需要澄清需求时调用,
// 挂起运行流并在右侧预览面板的「问题」标签中渲染表单,等待用户回答。

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// 单个问题的结构:与前端 AskUserPanel 的表单渲染一一对应
const questionSchema = z.object({
  id: z.string().describe('问题唯一标识,答案按此 id 回传'),
  title: z.string().describe('问题标题'),
  hint: z.string().optional().describe('补充说明'),
  type: z.enum(['single', 'multi', 'text']).describe('single=单选 multi=多选 text=自由文本'),
  options: z
    .array(
      z.object({
        label: z.string().describe('选项文案'),
        description: z.string().optional().describe('选项说明'),
      }),
    )
    .optional()
    .describe('single/multi 型的选项列表'),
  allowCustom: z.boolean().optional().describe('是否允许自由填写"其他"'),
});

export const askUserTool = createTool({
  id: 'ask_user',
  description:
    '向用户提出结构化的澄清问题并等待回答。当任务的关键信息不明确' +
    '(如风格倾向、目标受众、必须包含的内容)时调用,一次可以带多个问题。' +
    '不要为可以合理默认的琐碎细节调用。',
  inputSchema: z.object({ questions: z.array(questionSchema).min(1) }),
  outputSchema: z.object({
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    skipped: z.boolean(),
    note: z.string().optional(),
  }),
  suspendSchema: z.object({ questions: z.array(questionSchema).min(1) }),
  resumeSchema: z.object({
    answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    skip: z.boolean().optional(),
  }),
  execute: async (input, context) => {
    const { resumeData, suspend } = ((context as { agent?: unknown }).agent as
      | {
          resumeData?: { answers?: Record<string, string | string[]>; skip?: boolean };
          suspend?: (payload: { questions: typeof input.questions }) => Promise<{
            answers: Record<string, string | string[]>;
            skipped: boolean;
          }>;
        }
      | undefined) ?? {};

    // 与 sandbox-elevation 相同的显式校验:缺 suspend 会静默吞掉挂起,
    // 工具返回 undefined,agent 误以为成功。
    if (typeof suspend !== 'function') {
      throw new Error('ask_user 工具运行时上下文异常:缺少 suspend 能力');
    }

    // 首次执行:挂起等待用户作答(suspend 调用后必须立即 return)
    if (resumeData == null) {
      return await suspend({ questions: input.questions });
    }

    // 恢复执行:用户已提交答案,或选择"AI 自行决定"
    if (resumeData.skip) {
      return {
        answers: {},
        skipped: true,
        note: '用户选择由你自行决定,请基于已有信息做出最合理的假设并继续任务,不要再就此重复提问。',
      };
    }
    return {
      answers: resumeData.answers ?? {},
      skipped: false,
      note: '以上是用户对每个问题 id 的回答(text/单选为字符串,多选为字符串数组),请严格按用户的回答继续任务。',
    };
  },
});