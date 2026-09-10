import { registerApiRoute } from '@mastra/core/server';
import {
  createProject,
  deleteProject,
  getLinks,
  linkThread,
  listProjects,
} from '../services/project-store';

// 项目系统 HTTP 路由(H0)
// 仅本机可用;项目数据持久化于 storage/projects.json

export const projectRoutes = [
  registerApiRoute('/projects', {
    method: 'GET',
    handler: async c => c.json({ projects: await listProjects() }),
  }),

  registerApiRoute('/projects', {
    method: 'POST',
    handler: async c => {
      const body = (await c.req.json().catch(() => null)) as {
        name?: string;
        dir?: string;
      } | null;
      try {
        const project = await createProject({
          name: body?.name ?? '',
          dir: body?.dir,
        });
        return c.json(project);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: reason }, 400);
      }
    },
  }),

  registerApiRoute('/projects/:id', {
    method: 'DELETE',
    handler: async c => {
      await deleteProject(c.req.param('id'));
      return c.json({ ok: true });
    },
  }),

  registerApiRoute('/projects/link', {
    method: 'POST',
    handler: async c => {
      const body = (await c.req.json().catch(() => null)) as {
        threadId?: string;
        projectId?: string;
      } | null;
      if (!body?.threadId || !body?.projectId) {
        return c.json({ error: 'threadId 与 projectId 均为必填' }, 400);
      }
      try {
        await linkThread(body.threadId, body.projectId);
        return c.json({ ok: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return c.json({ error: reason }, 400);
      }
    },
  }),

  registerApiRoute('/projects/links', {
    method: 'GET',
    handler: async c => c.json({ links: await getLinks() }),
  }),
];
