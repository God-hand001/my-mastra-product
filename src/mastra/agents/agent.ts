import { Agent } from '@mastra/core/agent';
import { createSkill } from '@mastra/core/skills';
import { TaskSignalProvider } from '@mastra/core/signals';
// import { askUserTool, webFetchTool, webSearchTool } from '@mastra/core/tools';
import { webFetchTool } from '@mastra/core/tools';
import { LocalFilesystem, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { CodexSandbox } from '../services/codex-sandbox';
import { Memory } from '@mastra/memory';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';
import { projectListFilesTool, projectReadFileTool, projectWriteFileTool } from '../tools/project-tools';
import { docxBuildTool } from '../tools/docx-build';
import { htmlToPptxTool } from '../tools/html-to-pptx';
import { xlsxBuildTool } from '../tools/xlsx-build';
import { webSearchTool } from '../tools/web-search-tool';
import { enabledSkillDirs } from '../services/extension-store';
import { getCustomModel } from '../services/custom-models';
import { getRoleConfig } from '../services/workbench-roles';
import { getMcpTools } from '../services/connector-runtime';
import { requestSandboxElevationTool } from '../tools/sandbox-elevation';
import { askUserTool } from '../tools/ask-user';
import { requestScope, currentPermissionTier } from '../services/request-scope';
import { resolveTier } from '../services/sandbox-approval';

const workspacePath = 'workspace';

// execute_command 未显式指定 timeout 时的兜底上限(秒)。
// 取值权衡:够长以容纳安装/构建类命令,又能让卡死的命令在可接受时间内报错返回;
// 模型需要更久时可以在调用里显式传更大的 timeout。
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 120;

const workspace = new Workspace({
  id: 'agent-workspace',
  name: 'Agent Workspace',
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  // M11:命令执行进沙箱。CodexSandbox 覆盖框架的命令包裹点,前台 executeCommand 与
  // 后台 spawn 两条路径共用它,一处覆盖即全覆盖(见 services/codex-sandbox.ts 的注释)。
  // T15:档位通过请求作用域解析(requestScope),CodexSandbox 默认读取 currentPermissionTier(),
  // 保留 resolveTier 构造参数仅用于向后兼容。
  sandbox: new CodexSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    // execute_command 兜底超时:模型不传 timeout 时,Mastra 传给 execa 的 timeout 是
    // undefined(见 @mastra/core workspace bundle:`input.timeout != null ? input.timeout * 1e3 : void 0`),
    // 进程永不超时。而 sandbox 用 stdio:"pipe" 起进程且从不关闭 stdin,
    // 交互式命令会永久等待输入 —— 例如中文 Windows 上不带 /t 的 `date` 会打印
    // "输入新日期:" 然后一直挂着,前端的工具卡就永远停在"运行中…"。
    // 这里统一补一个上限,任何卡住的命令最终都会以超时错误返回,模型可以据此改用别的写法。
    hooks: {
      beforeToolCall: ctx => {
        if (ctx.workspaceToolName !== WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND) return;
        // T15:从工具执行上下文的 requestContext 解析档位,注入请求作用域,
        // 供 CodexSandbox.wrapCommandForIsolation 读取(enterWith 作用于当前
        // 异步链,并发请求各自独立,不会串档)。
        const ctxRecord = ctx.context as Record<string, unknown> | undefined;
        const rc = ctxRecord?.requestContext;
        if (rc != null) {
          requestScope.enterWith({ permission: resolveTier(rc) });
        }
        const input = ctx.input as { timeout?: number | null };
        if (input.timeout == null) input.timeout = DEFAULT_COMMAND_TIMEOUT_SECONDS;
      },
    },
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
  instructions: ({ requestContext }) => {
    const roleId = requestContext?.get('role');
    const role = getRoleConfig(roleId);
    const base = `你是"嘉立创助手",一个任务型 AI 助手:用户给你一项任务,你负责把它做完,而不是只给建议。

工作方式:
1. 接到任务后,先用一两句话说明执行计划,不要冗长
2. 需要外部信息或实际操作时,主动调用可用工具(网页搜索、网页抓取、文件读写、命令执行、定时任务等),分步执行直到完成
3. 最终用中文交付:结论先行、过程从简;产出文件时遵守产物输出规范

待办规划纪律:
- 多步任务(需要 3 次及以上工具调用、或含生成产物/搜索/写文件等多个阶段的)必须先用 task_write 工具把执行步骤登记成待办清单,再开始执行
- 每完成一步用 task_complete 标记完成,开始下一步前用 task_update 标记进行中;步骤内容有调整时用 task_update 同步修改 —— 待办清单会实时展示在右侧任务监控面板,是用户了解执行进度的主渠道,不能只在文字里描述计划而不登记待办

沙箱提权与审批纪律:
- 当 execute_command 等操作因沙箱策略(越界写、读敏感文件、联网等)被拒绝后,不要对同一命令反复重试,应立即调用 request_sandbox_elevation 工具,把被拒命令与原因原样传入,等待用户审批
- **提权获批后该命令已由工具代为执行完毕**(返回值含 rerun:true 与命令输出):直接采用该结果向用户汇报,**不要再自己执行一遍原命令** —— 对追加(>>)、计数、递增这类非幂等命令,重复执行会写入两次、产生重复内容。需要确认结果时只做只读校验(如读取文件内容),不要重复写入操作
- 审批被拒时,改用工作区内路径或替代方案完成任务,并如实告知用户
- 删除文件等破坏性操作由框架 requireApproval 机制审批,本工具不处理

联网搜索与引用规范:
- 涉及时事新闻、你不确定的事实、或用户明确要外部资料时,用 web_search 搜索;搜索词不要包含本地文件内容、密钥等敏感信息
- 回答中引用某条搜索结果的内容时,在对应句子后用 [编号] 标注;多次搜索时编号接续之前已用的最大编号往后排
- 使用过搜索的回答,末尾原样附上工具返回的 sourceListMarkdown("## 来源"小节);未使用搜索的回答不要添加来源小节

附件处理:
- 消息中的【附件:文件名】段落是用户上传文档的全文;回答相关问题时以附件内容为准,引用时注明来自哪个附件
- 附件内容不足以回答时明确说明,不要编造附件里没有的信息

效率与工具使用纪律:
- 消息中已包含【附件】全文时,直接基于该文本回答,不要再去工作区解析同名文件或用脚本重复提取
- 简单的文本问题(字数、找词、摘要)直接从附件/上下文回答,不要动用命令执行类工具
- 不要主动执行删除、清理类操作,除非用户明确要求
- 命令必须是非交互的:执行环境不会给命令喂输入,等待输入的命令会一直卡住直到超时。
  Windows 上查日期时间用 \`date /t\`、\`time /t\` 或 powershell Get-Date,不要用裸 \`date\`/\`time\`(会提示"输入新日期"并等待);
  同理给命令加上非交互参数(如 -y、--yes、--no-input),不要使用 vim/nano/more 之类需要人工操作的程序
- 执行环境是受限的(沙箱):命令与脚本只能读写工作区目录内的路径,不能写到工作区之外、
  不能读取凭据类文件(如 .env、SSH 私钥、浏览器数据),默认也不能联网。因此:
  - 产物、中间文件、临时文件一律放在工作区内
  - 安装依赖的命令(pip install / npm install 等)会失败,直接使用已预装的库
  - 遇到提示"被沙箱拒绝"时,说明是权限边界问题而非代码 bug:改用工作区内的路径重试;
    确实必须访问外部位置时,如实告知用户原因并说明需要他授权,**不要对同一个被拒操作反复重试**(最多再试一次)

项目任务:
- 当请求上下文包含当前项目时,涉及项目目录内文件的操作(列出/读取/写入)优先使用 project_* 三个项目工具
- 用户未选择项目时,若任务涉及项目文件,提醒用户先在首页选择项目

约束:
- 关键信息不明确时先向用户提问确认,不要瞎猜
- 遇到阻塞时说明原因,并给出你已经尝试过的路径
- 产物输出规范:每当生成或修改了文件(HTML/文档/代码/EDA 等),在该轮回复的末尾另起一行输出标记:【产物:文件名#相对路径】,相对路径相对于 workspace 根目录,一次生成多个文件就输出多行。除该标记外,回复正文中禁止出现任何本地路径、file:// 链接、绝对路径;对已完成产物只需用一句话自然说明,例如"贪吃蛇游戏已完成,可在右侧预览查看"。
- Word 生成规范:生成 .docx **直接编写并执行一个 docx.js(npm 包 "docx")脚本**(.js),不要走"先写 HTML 再转换"这条路径——HTML/CSS 中间层会损失样式精度,做不出贴合要求的排版效果(2026-09 用户实测对比确认)。写脚本前先用 skill 工具读取 docx 技能,严格遵循其中的坑位清单(页面尺寸单位、表格双宽度设置、Shading 必须用 CLEAR、PageBreak 必须包在 Paragraph 内、列表用 numbering 配置等,一步踩错会直接损坏文件或渲染错位)。脚本通过 docx_build 工具执行:脚本内自行 require("docx"),用 process.argv[2] 取得输出绝对路径,构建 Document 后 Packer.toBuffer(doc) 得到 Buffer 并 fs.writeFileSync 写盘。脚本跑完后按产物输出规范输出【产物:…】标记(只标记最终 .docx,不得把脚本标记为产物);生成失败时读取报错原因修正脚本重试,最多重试 2 次,仍失败如实告知,不要假装成功。
- PPT 生成规范:生成 .pptx **直接编写并执行一个 pptxgenjs 脚本**(.js),不要走"先写 HTML 再调用 html_to_pptx 工具转换"这条路径——该转换器会给每页强制盖一层固定品牌色主题,任何自定义配色都会被覆盖掉,做不出贴合主题的视觉(2026-09 用户实测确认)。写脚本前先用 skill 工具读取 pptx 技能,严格遵循其中的 pptxgenjs 坑位清单(颜色格式、图表配置、阴影偏移等,一步踩错会直接损坏文件);素材允许通过 web_search/web_fetch 检索真实图片后下载到工作区并本地引用。脚本跑完后按产物输出规范输出【产物:…】标记(只标记最终 .pptx,不得把脚本标记为产物);生成失败时读取报错原因修正脚本重试,最多重试 2 次,仍失败如实告知,不要假装成功
- 表格(xlsx)生成规范:先查看并遵循 excel-generation 技能,通过 xlsx-build 工具交付;禁止自行编写并执行生成脚本或绕过工具直接操作
- 扩展使用规范:
  - 系统提示附带的「可用技能清单」是你的能力索引:任务可能命中某个技能时(如写 Word/PPT/表格/PDF、前端设计、EDA 等),先用 skill 工具读取该技能再动手,遵循其中的流程与规范;不确定有没有合适技能时,用 skill_search 按关键词搜索
  - 用户通过输入框明确指定技能时,清单里会出现一条 user-requested-skill 条目,其中写明了用户指定的技能名;处理该请求时优先读取并遵循该技能
  - 连接器(MCP)提供的工具按其描述真实调用;工具列表里没有的工具名不要臆造,也不要假装调用成功;连接器工具调用失败时如实说明原因
- 网页引用规范:当需要用户查看某个网页时(如搜索到的来源、要展示的页面),在该轮回复末尾另起一行输出【网页:页面标题#完整网址】,一次引用多个网页就输出多行;网址必须是完整的 http/https 地址。正文中不再粘贴裸链接,改用一句自然语言说明(例如"相关页面已在右侧打开")。**特别注意:搜索类任务的来源也必须逐条用【网页:标题#网址】标记输出,严禁输出"## 来源"之类的 Markdown 链接列表段落**(前端会把标记聚合成来源徽章,Markdown 列表会破坏展示)。
`;
    if (!role.systemPrompt) return base;
    return `${base}\n\n${role.systemPrompt}\n\n${role.artifactHint}`;
  },
  // 模型按请求动态解析(M7:对话栏模型切换;M17:自定义模型接入)
  // 前端每条消息携带 requestContext.model;未指定时用默认模型。
  // custom/<条目id> 形式 → 查"我的模型"配置,返回 OpenAICompatibleConfig 对象形式
  // (Mastra 内部把它作为 createOpenAICompatible 的 baseURL,自动拼接 /chat/completions)。
  // 必须用 providerId/modelId 双字段变体:用户填的模型 ID 可能本身含斜杠
  // (如 deepseek-ai/DeepSeek-V4),单字符串 id 形式会被 Mastra 按第一个 / 拆坏。
  model: ({ requestContext }) => {
    const requested = requestContext?.get('model');
    if (typeof requested === 'string' && requested.startsWith('custom/')) {
      const entry = getCustomModel(requested.slice('custom/'.length));
      if (entry?.enabled) {
        return {
          providerId: 'custom',
          modelId: entry.modelId,
          url: entry.baseUrl,
          apiKey: entry.apiKey,
        };
      }
      // 条目不存在或已停用:回落默认模型,不中断对话
      return 'deepseek/deepseek-v4-flash';
    }
    return typeof requested === 'string' && requested ? requested : 'deepseek/deepseek-v4-flash';
  },
  defaultOptions: {
    maxSteps: 100,
    // autoResumeSuspendedTools 必须显式 false(T17):框架在检测不到审批 UI 时会默认
    // 当 true 处理(bundle 里 `canRenderApprovalButtons ? void 0 : true`),会把用户
    // 下一条自然语言消息自动解析成 suspend 流的 resumeData(「好的」→ approved:true),
    // 绕过审批卡片。决定权必须只在审批卡片上。
    autoResumeSuspendedTools: false,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  workspace,
  // M10:技能动态解析(Agent 级,而非 Workspace 级)。
  // 实测:Workspace 级 skills 的路径解析走 workspace 文件系统(沙箱限定在
  // src/mastra/public/workspace 内),仓库根下 extensions/ 的绝对路径会被
  // "path is outside the workspace" 拒绝;Agent 级 skills 用 process.cwd() 基准的
  // LocalSkillSource,绝对路径可用。
  // 每次请求按扩展注册表返回启用技能的绝对路径目录;requestContext.skill(输入框
  // 手动指定的技能)强制包含(即使被禁用)。
  // 注意:技能清单注入系统提示时会按名称排序(prompt cache 稳定性),resolver 的
  // 返回顺序不体现优先级;因此"用户手动指定"用一条 inline skill 显式告知 agent,
  // 而不是依赖置首。
  skills: ({ requestContext }) => {
    if (!requestContext) return enabledSkillDirs();
    const requested = requestContext.get('skill');
    const skillName = typeof requested === 'string' ? requested : undefined;
    const roleId = requestContext.get('role');
    const role = getRoleConfig(roleId);
    let dirs = enabledSkillDirs({ skill: skillName });
    // F8:角色 enabledSkills 非空时,只保留白名单内的技能目录(按目录名匹配技能名);
    // F9:显式指定的技能(skillName)不受角色白名单限制,即使不在白名单也要保留 ——
    // 用户手动选的技能优先级高于角色默认限制。
    if (role.enabledSkills) {
      const whitelist = new Set(role.enabledSkills);
      dirs = dirs.filter(dir => {
        const dirName = dir.split(/[\\/]/).pop() ?? '';
        return whitelist.has(dirName) || dirName === skillName;
      });
    }
    if (!skillName) return dirs;
    return [
      ...dirs,
      createSkill({
        name: 'user-requested-skill',
        description: `用户在本条消息中通过输入框明确指定使用技能「${skillName}」`,
        instructions: `用户在本条消息中通过输入框明确指定使用技能「${skillName}」。处理本次请求时,应优先调用 skill 工具读取技能「${skillName}」的完整内容并遵循其指示;该技能与本任务只有部分相关时也应尽量结合。`,
      }),
    ];
  },
  // M10:工具动态解析。基础工具保持不变,每次请求并入连接器(MCP)工具;
  // 连接器 toggle 后 connector-runtime refresh 即生效,无需重建 Agent。
  // M15-F16:仅 design/slides 角色暴露结构化提问;general 不挂载
  tools: async ({ requestContext }) => {
    const role = getRoleConfig(requestContext?.get('role'));
    return {
      start_schedule: startScheduleTool,
      stop_schedule: stopScheduleTool,
      web_fetch: webFetchTool,
      web_search: webSearchTool,
      project_list_files: projectListFilesTool,
      project_read_file: projectReadFileTool,
      project_write_file: projectWriteFileTool,
      docx_build: docxBuildTool,
      html_to_pptx: htmlToPptxTool,
      xlsx_build: xlsxBuildTool,
      request_sandbox_elevation: requestSandboxElevationTool,
      // M15-F16:仅 design/slides 角色暴露结构化提问;general 不挂载
      ...(role.id === 'design' || role.id === 'slides' ? { ask_user: askUserTool } : {}),
      // M16:设计计划确认工具,与 ask_user 同角色白名单(仅 design)
      ...(role.id === 'design' ? { enter_design_plan: enterDesignPlanTool } : {}),
      // MCP 连接器工具,以 serverName_toolName 命名空间并入;失败的连接器无工具但不抛错
      ...(await getMcpTools()),
    };
  },
  signals: [new TaskSignalProvider()],
});
import { enterDesignPlanTool } from '../tools/design-plan';
