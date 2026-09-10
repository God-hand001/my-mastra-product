import { registerApiRoute } from '@mastra/core/server';
import { ensureThreadSubscription } from './thread-subscriptions';

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
      const agent = await mastra.getAgent(AGENT_ID);
      await ensureThreadSubscription(agent, schedule.threadId, schedule.resourceId ?? RESOURCE_ID);
      const result = await agent.generate(schedule.prompt, {
        memory: { thread: schedule.threadId, resource: schedule.resourceId ?? RESOURCE_ID },
      });
      return c.json({ ok: true, text: result.text });
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
