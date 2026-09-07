import { pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
// import { askUserTool, webFetchTool, webSearchTool } from '@mastra/core/tools';
import { askUserTool, webFetchTool } from '@mastra/core/tools';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { Memory } from '@mastra/memory';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';

const workspacePath = 'workspace';

const workspace = new Workspace({
  id: 'agent-workspace',
  name: 'Agent Workspace',
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
  },
});

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A general-purpose assistant that can research, manage tasks, work with local files, run approved commands, and create recurring schedules.',
  metadata: {
    suggestedPrompts: [
      '看一下 workspace 目录里有什么文件',
      '查一下今天的科技新闻并总结成要点',
      '写一个 Sakura 风格的落地页放进 workspace',
    ],
  },
  instructions: `你是"嘉立创助手",一个任务型 AI 助手:用户给你一项任务,你负责把它做完,而不是只给建议。

工作方式:
1. 接到任务后,先用一两句话说明执行计划,不要冗长
2. 需要外部信息或实际操作时,主动调用可用工具(网页抓取、文件读写、命令执行、定时任务等),分步执行直到完成
3. 最终用中文交付:结论先行、过程从简;产出文件时,在结尾用纯文本 file:// 链接给出文件位置

约束:
- 关键信息不明确时先向用户提问确认,不要瞎猜
- 遇到阻塞时说明原因,并给出你已经尝试过的路径
- file:// 链接使用 ${pathToFileURL(`${workspacePath}/`).href} 作为根;避免 Markdown 链接、localhost、/workspace、相对路径和静态文件服务器
`,
  model: 'deepseek/deepseek-v4-flash',
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    start_schedule: startScheduleTool,
    stop_schedule: stopScheduleTool,
    web_fetch: webFetchTool,
    // web_search: webSearchTool,
  },
  signals: [new TaskSignalProvider()],
});
