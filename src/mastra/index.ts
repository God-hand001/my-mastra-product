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
import { docxBuildTool } from './tools/docx-build';
import { htmlToPptxTool } from './tools/html-to-pptx';
import { xlsxBuildTool } from './tools/xlsx-build';
import { chatRoute } from '@mastra/ai-sdk';
import { driveRoutes } from './server/drive-routes';
import { scheduleRoutes } from './server/schedule-routes';
import { projectRoutes } from './server/project-routes';
import { workspaceRoutes } from './server/workspace-routes';
import { contextRoutes } from './server/context-routes';
import { summaryRoutes } from './server/summary-routes';
import { extensionRoutes } from './server/extension-routes';
import { ensureThreadSubscription } from './server/thread-subscriptions';
import { approvalRoutes } from './server/approval-routes';
import { customModelRoutes } from './server/custom-model-routes';
import { refresh as refreshConnectors } from './services/connector-runtime';
import { prewarmSandbox, sandboxPreflight } from './services/sandbox-runtime';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { agent },
  tools: { startScheduleTool, stopScheduleTool, docxBuildTool, htmlToPptxTool, xlsxBuildTool },
  server: {
    // 桌面壳(file://)与 5173 开发页直连 4111 时需要跨域许可(M6)
    cors: {
      origin: '*',
      allowMethods: ['*'],
      allowHeaders: ['*'],
    },
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
        // 默认 false 会导致 reasoning part 在 step 结束才一次性到达,
        // 前端思考块无法流式显示(用户反馈 2026-09-18);置 true 后实时转发
        sendReasoning: true,
      }),
      ...driveRoutes,
      ...scheduleRoutes,
      ...projectRoutes,
      ...workspaceRoutes,
      ...contextRoutes,
      ...summaryRoutes,
      ...extensionRoutes,
      ...approvalRoutes,
      ...customModelRoutes,
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

// M11:沙箱自检与预热。
// 放在连接器预热之前 —— 子进程围栏是它们的前置条件,先把状态暴露在启动日志里,
// 而不是等第一次工具调用才炸。
// 预检失败**不中断启动**:让用户能进产品看到提示与修复命令,而不是黑屏;
// 真正的 fail-closed 在工具调用层(沙箱不可用时报错,绝不退回无防护执行)。
{
  const preflight = sandboxPreflight();
  if (preflight.ok) {
    console.log(`[沙箱] ${preflight.message}`);
    // 冷启动首次调用实测可达 16.5s(访问控制项首次应用),稳态 1.3–2.0s。
    // 这里先付掉,避免用户的第一次请求承担它;失败不阻塞启动。
    void prewarmSandbox().then(result => {
      console.log(`[沙箱] ${result.message}`);
    });
  } else {
    console.error(`[沙箱] 不可用,需要子进程的工具(命令执行/文档生成/连接器)将无法工作:\n${preflight.message}`);
  }
}

// M10:启动时预热连接器(拉起已启用的 MCP server 并预取工具列表)。
// 失败原因由 connector-runtime 写入注册表面板展示;预热失败不阻塞启动。
void refreshConnectors().catch(error => {
  console.error('连接器预热失败(可稍后在扩展面板重试)', error);
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
