// 全前端唯一的工具元信息映射源:ToolCallCard 与状态行共用
// 规则自上而下,首个命中生效

export interface ToolMetaRule {
  pattern: RegExp;
  running: string; // 进行时文案
  done: string; // 完成时文案
  icon: string; // emoji 图标
}
// 关键参数摘要的提取逻辑统一在 toolSummary 内(按优先级遍历),
// 不作为每条规则的字段,避免每条规则重复书写提取函数。

const RULES: ToolMetaRule[] = [
  { pattern: /project_list/i, running: '正在查看列表', done: '已查看列表', icon: '📂' },
  { pattern: /project_read/i, running: '正在查阅文件', done: '已查阅文件', icon: '📄' },
  { pattern: /project_write/i, running: '正在创建文件', done: '已创建文件', icon: '✏️' },
  { pattern: /start_schedule/i, running: '正在创建定时任务', done: '已创建定时任务', icon: '⏰' },
  { pattern: /stop_schedule/i, running: '正在停止定时任务', done: '已停止定时任务', icon: '🛑' },
  { pattern: /delete/i, running: '正在删除文件', done: '已删除文件', icon: '🗑️' },
  { pattern: /execute_command|command/i, running: '正在执行命令', done: '已执行命令', icon: '⚡' },
  { pattern: /file_stat/i, running: '正在检查文件', done: '已检查文件', icon: '🔍' },
  // Mastra 内置待办工具族(task_write/update/complete/check):显示为规划类语义卡,
  // 摘要行不露 args JSON(toolSummary 对数组参数返回空)
  { pattern: /task_write|task_update/i, running: '正在规划步骤', done: '已规划步骤', icon: '📋' },
  { pattern: /task_complete/i, running: '正在完成任务', done: '已完成任务', icon: '✅' },
  { pattern: /task_check/i, running: '正在核对任务', done: '已核对任务', icon: '🔍' },
  // 写入/读取/列出类用语义短标题(对齐千问:创建文件/查阅文件/查看列表)
  { pattern: /write_file|write|edit/i, running: '正在创建文件', done: '已创建文件', icon: '📝' },
  { pattern: /read_file|read/i, running: '正在查阅文件', done: '已查阅文件', icon: '📖' },
  { pattern: /list_files|list/i, running: '正在查看列表', done: '已查看列表', icon: '📋' },
  { pattern: /web_search|search/i, running: '正在搜索内容', done: '已搜索内容', icon: '🌐' },
  { pattern: /web_fetch|fetch/i, running: '正在浏览网页', done: '已浏览网页', icon: '🕸️' },
  { pattern: /ask_user/i, running: '正在等待你的输入', done: '已收到你的输入', icon: '💬' },
  { pattern: /mkdir/i, running: '正在创建文件夹', done: '已创建文件夹', icon: '📁' },
  { pattern: /html_to_docx/i, running: '正在生成 Word', done: '已生成 Word 文档', icon: '📄' },
  { pattern: /html_to_pptx/i, running: '正在生成 PPT', done: '已生成 PPT 文档', icon: '📊' },
  { pattern: /xlsx_build/i, running: '正在生成表格', done: '已生成表格', icon: '📈' },
  { pattern: /request_sandbox_elevation/i, running: '正在请求沙箱提权', done: '已提交提权请求', icon: '🔐' },
  { pattern: /skill/i, running: '正在使用技能', done: '已使用技能', icon: '🧩' },
];

// 去掉 Mastra 内置工具的命名空间前缀(mastra_workspace_execute_command → execute_command)
export function stripToolPrefix(toolName: string): string {
  return toolName.replace(/^(mastra[_.]|workspace[_.])+/gi, '');
}

function findRule(toolName: string): ToolMetaRule | undefined {
  const name = stripToolPrefix(toolName);
  for (const rule of RULES) {
    if (rule.pattern.test(name)) return rule;
  }
  return undefined;
}

// 工具名 → 进行时中文文案,供流式阶段行使用(规则自上而下,首个命中生效)
// 返回值不带省略号,由调用方按需拼接
export function toolPhaseLabel(toolName: string): string {
  return findRule(toolName)?.running ?? '正在处理';
}

// 工具名 → 完成时中文文案;未命中规则时返回'已完成'
export function toolDoneLabel(toolName: string): string {
  return findRule(toolName)?.done ?? '已完成';
}

// 工具名 → emoji 图标;未命中规则时返回'🛠'
export function toolIcon(toolName: string): string {
  return findRule(toolName)?.icon ?? '🛠';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '…';
}

// 从工具参数中提取关键信息作为摘要
// 优先级:filePath → command → query/keyword → url → name/skill → 首个字符串类型值
// 超过 60 字符截断并加'…';无匹配返回空字符串
export function toolSummary(args: Record<string, unknown>): string {
  const raw: unknown[] = [
    args.filePath,
    args.command,
    args.query,
    args.keyword,
    args.url,
    args.name,
    args.skill,
  ];
  for (const value of raw) {
    if (typeof value === 'string' && value !== '') {
      return truncate(value, 60);
    }
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '') {
      return truncate(value, 60);
    }
  }
  return '';
}
