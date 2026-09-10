import { pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
// import { askUserTool, webFetchTool, webSearchTool } from '@mastra/core/tools';
import { askUserTool, webFetchTool } from '@mastra/core/tools';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { Memory } from '@mastra/memory';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';
import { webSearchTool } from '../tools/web-search-tool';

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
2. 需要外部信息或实际操作时,主动调用可用工具(网页搜索、网页抓取、文件读写、命令执行、定时任务等),分步执行直到完成
3. 最终用中文交付:结论先行、过程从简;产出文件时,在结尾用纯文本 file:// 链接给出文件位置

联网搜索与引用规范:
- 涉及时事新闻、你不确定的事实、或用户明确要外部资料时,用 web_search 搜索;搜索词不要包含本地文件内容、密钥等敏感信息
- 回答中引用���条搜索结果的内容时,在对应句子后用 [编号] 标注;多次搜索时编号接续之前已用的最大编号往后排
- 使用过搜索的回答,末尾原样附上工具返回的 sourceListMarkdown("## 来源"小节);未使用搜索的回答不要添加来源小节

附件处理:
- 消息中的【附件:文件名】段落是用户上传文档的全文;回答相关问题时以附件内容为准,引用时注明来自哪个附件
- 附件内容不足以回答时明确说明,不要编造附件里没有的信息

效率与工具使用纪律:
- 消息中已包含【附件】全文时,直接基于该文本回答,不要再去工作区解析同名文件或用脚本重复提取
- 简单的文本问题(字数、找词、摘要)直接从附件/上下文回答,不要动用命令执行类工具
- 不要主动执行删除、清理类操作,除非用户明确要求

约束:
- 关键信息不明确时先向用户提问确认,不要瞎猜
- 遇到阻塞时说明原因,并给出你已经尝试过的路径
- file:// 链接使用 ${pathToFileURL(`${workspacePath}/`).href} 作为根;避免 Markdown 链接、localhost、/workspace、相对路径和静态文件服务器
`,
  // 模型按请求动态解析(M7:对话栏模型切换)
  // 前端每条消息携带 requestContext.model;未指定时用默认模型
  model: ({ requestContext }) => {
    const requested = requestContext?.get('model');
    return typeof requested === 'string' && requested ? requested : 'deepseek/deepseek-v4-flash';
  },
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
    web_search: webSearchTool,
  },
  signals: [new TaskSignalProvider()],
});
