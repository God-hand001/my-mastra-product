import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { chatRoute } from '@mastra/ai-sdk';
import { driveRoutes } from './server/drive-routes';
import { scheduleRoutes } from './server/schedule-routes';
import { ensureThreadSubscription } from './server/thread-subscriptions';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent },
  tools: { startScheduleTool, stopScheduleTool },
  server: {
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
      }),
      ...driveRoutes,
      ...scheduleRoutes,
    ],
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

// 服务重启后恢复已有定时任务线程的订阅，避免旧任务只能“触发成功”却不执行模型。
void (async () => {
  try {
    const runtimeAgent = await mastra.getAgent('agent');
    const schedules = await mastra.schedules.list({ agentId: 'agent' });
    await Promise.all(
      schedules.map(schedule => {
        const threaded = schedule as typeof schedule & { threadId?: string; resourceId?: string };
        return threaded.threadId
          ? ensureThreadSubscription(runtimeAgent, threaded.threadId, threaded.resourceId ?? 'local-user')
          : undefined;
      }),
    );
  } catch (error) {
    console.error('恢复定时任务线程订阅失败', error);
  }
})();
