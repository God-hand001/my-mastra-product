import type { ToolCallMessagePartProps } from '@assistant-ui/react';

// 工具调用卡(P2:文案与状态对齐千问办公)
// 运行中:⟳ 动画 + "正在…";完成:✓ + "已…";错误:✗ + 红色
// 结果/参数默认折叠,点击展开

type ToolState = 'running' | 'done' | 'failed';

// 工具名 → 状态文案(关键词匹配,前缀归一化后按序命中)
const LABEL_RULES: Array<[RegExp, string, string]> = [
  [/project_list/i, '正在列出项目文件', '已列出项目文件'],
  [/project_read/i, '正在读取项目文件', '已读取项目文件'],
  [/project_write/i, '正在写入项目文件', '已写入项目文件'],
  [/start_schedule/i, '正在创建定时任务', '已创建定时任务'],
  [/stop_schedule/i, '正在停止定时任务', '已停止定时任务'],
  [/delete/i, '正在删除文件', '已删除文件'],
  [/execute_command|command/i, '正在执行命令', '已执行命令'],
  [/file_stat/i, '正在检查文件', '已检查文件'],
  [/list_files|list/i, '正在列出文件', '已列出文件'],
  [/read_file|read/i, '正在读取文件', '已读取文件'],
  [/write_file|write|edit/i, '正在写入文件', '已写入文件'],
  [/web_search|search/i, '正在搜索网页', '已完成搜索'],
  [/web_fetch|fetch/i, '正在抓取网页', '已完成抓取'],
  [/ask_user/i, '正在等待你的输入', '已收到你的输入'],
  [/mkdir/i, '正在创建文件夹', '已创建文件夹'],
];

function statusOf(props: ToolCallMessagePartProps): ToolState {
  if (props.isError) return 'failed';
  const st = (props as { status?: { type?: string } }).status;
  if (st?.type === 'running' || st?.type === 'streaming') return 'running';
  if (props.result === undefined) return 'running';
  return 'done';
}

function labelFor(toolName: string, state: ToolState): string {
  const name = toolName.replace(/^(mastra[_.]|workspace[_.])+/gi, '');
  for (const [re, running, done] of LABEL_RULES) {
    if (re.test(name)) return state === 'running' ? running : done;
  }
  return state === 'running' ? '正在处理' : '已完成';
}

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const { toolName, args, result, isError } = props;
  const state = statusOf(props);

  const formatValue = (value: unknown): string => {
    if (value == null) return '';
    try {
      const json = JSON.stringify(value, null, 2);
      return json.length > 800 ? `${json.slice(0, 800)}\n…(输出过长,已截断)` : json;
    } catch {
      return String(value);
    }
  };

  const formattedArgs = formatValue(args);
  const formattedResult = formatValue(result);

  return (
    <details
      className={`tool-card${state === 'running' ? ' is-running' : ''}${state === 'failed' ? ' is-error' : ''}`}
    >
      <summary className="tool-card-summary">
        <span className="tool-card-icon">
          {state === 'running' ? (
            <span className="tool-card-spinner" />
          ) : state === 'failed' ? (
            '✗'
          ) : (
            '✓'
          )}
        </span>
        <span className="tool-card-label">{labelFor(toolName, state)}</span>
        <span className="tool-card-chev">▾</span>
      </summary>
      <div className="tool-card-body">
        {formattedArgs && (
          <>
            <div className="tool-card-label">参数</div>
            <pre className="tool-card-pre">{formattedArgs}</pre>
          </>
        )}
        {formattedResult && (
          <>
            <div className="tool-card-label">结果</div>
            <pre className="tool-card-pre">{formattedResult}</pre>
          </>
        )}
      </div>
    </details>
  );
}
