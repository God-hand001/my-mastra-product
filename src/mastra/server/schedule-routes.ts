import { registerApiRoute } from '@mastra/core/server';

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
        title?: string;
        prompt?: string;
        cron?: string;
      } | null;
      const title = body?.title?.trim();
      const prompt = body?.prompt?.trim();
      const cron = body?.cron?.trim();
      if (!title || !prompt || !cron) {
        return c.json({ error: 'title、prompt、cron 均为必填' }, 400);
      }
      const mastra = c.get('mastra');
      try {
        const agent = await mastra.getAgent(AGENT_ID);
        const memory = await agent.getMemory();
        // F3:页面创建的定时任务绑定专属任务线程,执行历史沉淀其中
        const thread = await memory.createThread({ resourceId: RESOURCE_ID, title });
        const view = await mastra.schedules.create({
          agentId: AGENT_ID,
          cron,
          prompt,
          threadId: thread.id,
          resourceId: RESOURCE_ID,
          name: title,
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
      await c.get('mastra').schedules.run(c.req.param('id'));
      return c.json({ ok: true });
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
