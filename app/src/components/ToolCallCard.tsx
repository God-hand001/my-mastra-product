import type { ToolCallMessagePartProps } from '@assistant-ui/react';

// 工具调用卡片(F2:执行过程可见,非黑盒)
// 以可折叠行内卡片展示:工具名、运行状态、参数与结果摘要
export function ToolCallCard(props: ToolCallMessagePartProps) {
  const { toolName, args, result, isError } = props;
  const running = isError !== true && result === undefined;

  const formatValue = (value: unknown): string => {
    if (value == null) return '';
    try {
      const json = JSON.stringify(value, null, 2);
      return json.length > 800 ? `${json.slice(0, 800)}\n…(已截断)` : json;
    } catch {
      return String(value);
    }
  };

  const statusLabel = isError ? '失败' : running ? '运行中…' : '已完成';
  const formattedArgs = formatValue(args);
  const formattedResult = formatValue(result);

  return (
    <details
      className={`tool-call-card${running ? ' is-running' : ''}${isError ? ' is-error' : ''}`}
    >
      <summary>
        <span className="tool-call-name">🛠 {toolName}</span>
        <span className={`tool-call-status${running ? ' running' : ''}`}>{statusLabel}</span>
      </summary>
      <div className="tool-call-body">
        {formattedArgs && (
          <>
            <div className="tool-call-label">参数</div>
            <pre className="tool-call-pre">{formattedArgs}</pre>
          </>
        )}
        {formattedResult && (
          <>
            <div className="tool-call-label">结果</div>
            <pre className="tool-call-pre">{formattedResult}</pre>
          </>
        )}
      </div>
    </details>
  );
}
