import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { ensureThreadSubscription } from './thread-subscriptions';

// 重新生成的善后清理:按 id 删除被替换掉的那条旧 assistant 消息。
//
// 前端走 AI SDK 原生 regenerate(trigger=regenerate-message),chatRoute 会丢掉末尾旧回复
// 重新生成,但它的 lastMessageId 只作用于 AI SDK 流转换层 —— 界面是替换,memory 里
// 新回复通常另起一条,旧回复仍然留着(刷新页面会看到两条)。
//
// 保护条件:仅当线程里存在比目标更新的 assistant 消息时才删。
// 这样万一某版本改为同 id 覆写(此时目标就是最新那条),不会误删刚生成的新回复;
// 删除失败/条件不满足都只是留下一条旧记录,不会破坏会话。
// 返回是否真的删除,便于前端排查。
async function deleteAssistantMessage(
  mastra: Mastra,
  threadId: string,
  resourceId: string,
  messageId: string,
): Promise<boolean> {
  const agent = await mastra.getAgent(AGENT_ID);
  const memory = await agent.getMemory();
  if (!memory) return false;

  // recall 是 MastraMemory 上读取线程消息的公开 API(perPage: false = 不分页取全量)。
  // 线程不存在时它会抛错;清理属于尽力而为,这种情况本就无可删,记录后按"未删除"返回。
  let messages;
  try {
    ({ messages } = await memory.recall({ threadId, resourceId, perPage: false }));
  } catch (err) {
    console.error('读取线程消息失败,跳过旧回复清理', err);
    return false;
  }
  const target = messages.find(m => m.id === messageId);
  // 目标已不存在(例如重复点击、已清理过):无需处理
  if (!target) return false;

  // 是否存在比目标更新的 assistant 消息 —— 按 createdAt 判断而非数组下标,
  // recall 的排序方向不保证,靠位置判断"谁更新"不可靠。
  // 时间戳相同(极快写入)时视为不可删,宁可留一条旧记录也不误删新回复。
  const targetAt = target.createdAt.getTime();
  const hasNewerAssistant = messages.some(
    m => m.role === 'assistant' && m.createdAt.getTime() > targetAt,
  );
  if (!hasNewerAssistant) return false;

  await memory.deleteMessages([messageId]);
  return true;
}

// 定时任务 HTTP 路由(M3)
// 封装 mastra.schedules CRUD;页面创建时绑定专属任务线程(spec F3)
const AGENT_ID = 'agent';
const RESOURCE_ID = 'local-user';

export const scheduleRoutes = [
  registerApiRoute('/schedules', {
    method: 'GET',
    handler: async c => {
      const mastra = c.get('mastra');
      const views = await mastra.schedules.list({ agentId: AGENT_ID });
      return c.json({ schedules: views });
    },
  }),

  registerApiRoute('/schedules', {
    method: 'POST',
    handler: async c => {
      const body = (await c.req.json().catch(() => null)) as {
        name?: string;
        description?: string;
        type?: 'once' | 'interval' | 'cron';
        at?: string;
        everyN?: number;
        everyUnit?: 'minutes' | 'hours';
        cron?: string;
      } | null;
      const name = body?.name?.trim();
      const description = body?.description?.trim();
      const type = body?.type ?? 'cron';
      if (!name || !description) {
        return c.json({ error: '任务名称与任务描述均为必填' }, 400);
      }

      // 对齐千问:三种调度类型 → cron 表达��(一次性=指定日期时间;固定间隔=步进 cron)
      let cron: string;
      if (type === 'once') {
        const at = body?.at ? new Date(body.at) : null;
        if (!at || Number.isNaN(at.getTime())) {
          return c.json({ error: '请选择执行时间' }, 400);
        }
        if (at.getTime() <= Date.now()) {
          return c.json({ error: '计划时间必须是未来时间' }, 400);
        }
        cron = `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth() + 1} *`;
      } else if (type === 'interval') {
        const n = Number(body?.everyN);
        const unit = body?.everyUnit ?? 'minutes';
        if (!Number.isInteger(n) || n < 1) {
          return c.json({ error: '请输入有效的间隔数值' }, 400);
        }
        if (unit === 'minutes') {
          if (n > 59) return c.json({ error: '分钟间隔需在 1~59 之间(更大的间隔请用小时)' }, 400);
          cron = `*/${n} * * * *`;
        } else {
          if (n > 23) return c.json({ error: '小时间隔需在 1~23 之间(更长的间隔请用 Cron 表达式)' }, 400);
          cron = `0 */${n} * * *`;
        }
      } else {
        cron = body?.cron?.trim() ?? '';
        if (!cron) return c.json({ error: '请输入 Cron 表达式' }, 400);
      }

      const mastra = c.get('mastra');
      try {
        const agent = await mastra.getAgent(AGENT_ID);
        const memory = await agent.getMemory();
        if (!memory) throw new Error('Agent memory is not configured');
        // F3:页面创建的定时任务绑定专属任务线程,执行历史沉淀其中
        const thread = await memory.createThread({ resourceId: RESOURCE_ID, title: name });
        await ensureThreadSubscription(agent, thread.id, RESOURCE_ID);
        const view = await mastra.schedules.create({
          agentId: AGENT_ID,
          cron,
          prompt: description,
          threadId: thread.id,
          resourceId: RESOURCE_ID,
          name,
          // bare=1 实验参数:不带投递选项(验证信号管线)
          ...(new URL(c.req.url).searchParams.get('bare')
            ? {}
            : {
                // 定时请求属于用户委托的任务，按用户消息进入线程，便于历史记录直接展示。
                signalType: 'user-message',
                // 显式指定投递行为:线程空闲时唤醒 agent 生成(spec:触发结果写入线程)
                ifIdle: { behavior: 'wake' },
                // 线程正在运行时把任务投递给当前循环，而不是仅落库等待下一次对话。
                ifActive: { behavior: 'deliver' },
              }),
        });
        return c.json(view);
      } catch (err) {
        // cron 非法等校验错误由 schedules.create 抛出,转成 400(N1)
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: `创建失败: ${reason}` }, 400);
      }
    },
  }),

  // 重新生成后清理被替换的旧 assistant 消息(前端在流式结束后调用)
  //
  // 路径刻意不放在 /chat 下:chatRoute 注册了 /chat/:agentId 且排在自定义路由之前,
  // 任何 /chat/xxx 都会被它当成 agentId 吃掉(找不到 agent → 500)。
  // 之前的 /chat/delete-last-assistant 就是这样从未真正生效过。
  registerApiRoute('/messages/delete-assistant', {
    method: 'POST',
    handler: async c => {
      const body = (await c.req.json().catch(() => null)) as {
        threadId?: string;
        resourceId?: string;
        messageId?: string;
      } | null;
      if (!body?.threadId || !body?.resourceId || !body?.messageId) {
        return c.json({ error: 'threadId、resourceId 和 messageId 均为必填' }, 400);
      }
      try {
        const deleted = await deleteAssistantMessage(
          c.get('mastra'),
          body.threadId,
          body.resourceId,
          body.messageId,
        );
        return c.json({ ok: true, deleted });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: reason }, 500);
      }
    },
  }),

  registerApiRoute('/schedules/:id/pause', {
    method: 'POST',
    handler: async c => {
      await c.get('mastra').schedules.pause(c.req.param('id'));
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/schedules/:id/resume', {
    method: 'POST',
    handler: async c => {
      await c.get('mastra').schedules.resume(c.req.param('id'));
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/schedules/:id/run', {
    method: 'POST',
    handler: async c => {
      const mastra = c.get('mastra');
      const schedule = await mastra.schedules.get(c.req.param('id'));
      if (!schedule || !('agentId' in schedule) || schedule.agentId !== AGENT_ID) {
        return c.json({ error: '定时任务不存在' }, 404);
      }
      if (!schedule.threadId) {
        return c.json({ error: '定时任务没有绑定会话' }, 400);
      }

      // “立即运行一次”是用户主动操作，直接执行一次 Agent 并等待完成，
      // 这样按钮请求结束时 assistant 消息已经写入对应任务会话，而不是只登记一条 scheduler trigger。
      //
      // 这里必须 try/catch:此前没有捕获,任何底层异常(线程订阅冲突、模型调用失败等)
      // 都被 Hono 默认错误处理吞成一句"Internal Server Error",前端只显示"立即执行失败(500)",
      // 排查时完全看不到真实原因(2026-09-20 用户反馈)。
      try {
        const agent = await mastra.getAgent(AGENT_ID);
        await ensureThreadSubscription(agent, schedule.threadId, schedule.resourceId ?? RESOURCE_ID);
        const result = await agent.generate(schedule.prompt, {
          memory: { thread: schedule.threadId, resource: schedule.resourceId ?? RESOURCE_ID },
        });
        return c.json({ ok: true, text: result.text });
      } catch (err) {
        console.error(`定时任务立即执行失败 (${schedule.threadId})`, err);
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: `立即执行失败: ${message}` }, 500);
      }
    },
  }),

  registerApiRoute('/schedules/:id', {
    method: 'DELETE',
    handler: async c => {
      await c.get('mastra').schedules.delete(c.req.param('id'));
      return c.json({ ok: true });
    },
  }),
];
