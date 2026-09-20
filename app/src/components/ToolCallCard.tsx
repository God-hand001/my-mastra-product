import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { toolDoneLabel, toolIcon, toolPhaseLabel, toolSummary } from '../lib/toolMeta';

// 兼容旧导入:AssistantSteps.tsx 仍从这里导入 toolPhaseLabel,批 3 迁移后删除此行
export { toolPhaseLabel } from '../lib/toolMeta';

type DiffHunk = {
  type: 'add' | 'del' | 'ctx';
  text: string;
};

type DiffShape = {
  isNew?: boolean;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  truncated?: boolean;
};

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '…';
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 800 ? `${json.slice(0, 800)}\n…(输出过长,已截断)` : json;
  } catch {
    return String(value);
  }
}

function extractErrorSummary(result: unknown): string {
  if (typeof result === 'string') {
    const line = result.split(/\r?\n/).find(l => l.trim() !== '') ?? '';
    return truncate(line.trim(), 80);
  }
  if (result && typeof result === 'object') {
    const err = (result as Record<string, unknown>).error;
    if (typeof err === 'string') return truncate(err, 80);
    if (err != null) return truncate(String(err), 80);
  }
  return '';
}

function DiffView({ diff }: { diff: DiffShape }) {
  const add = diff.added ?? 0;
  const del = diff.removed ?? 0;
  const hunks = diff.hunks ?? [];

  if (hunks.length === 0 && diff.truncated) {
    return <div className="tool-call-diff-empty">差异过大,已省略</div>;
  }

  return (
    <div className="tool-call-diff">
      <div className="tool-call-diff-stats">
        <span className="diff-stat-add">+{add}</span>
        <span className="diff-stat-del">-{del}</span>
        {diff.truncated && <span className="diff-stat-truncated">(已截断)</span>}
      </div>
      <pre className="tool-call-diff-pre">
        {hunks.map((hunk, i) => {
          const prefix = hunk.type === 'add' ? '+' : hunk.type === 'del' ? '-' : ' ';
          const cls = `diff-line diff-line-${hunk.type}`;
          return (
            <div key={i} className={cls}>
              <span className="diff-line-prefix" aria-hidden="true">{prefix}</span>
              <span className="diff-line-text">{hunk.text}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export function ToolCallCard(props: ToolCallMessagePartProps) {
  const { toolName, args, result, isError, status } = props;

  // 状态判定:优先 props.status.type;status 缺失(历史消息)回退旧判定
  const statusType = status?.type;
  const running =
    statusType === 'running' ||
    (statusType === undefined && isError !== true && result === undefined);
  const failed =
    statusType === 'incomplete' ||
    (statusType === undefined && isError === true);

  const actionLabel = running ? toolPhaseLabel(toolName) : toolDoneLabel(toolName);
  const summaryHint = toolSummary((args ?? {}) as Record<string, unknown>);
  const statusWord = running ? '运行中…' : failed ? '失败' : '已完成';
  const errorSummary = failed ? extractErrorSummary(result) : '';

  const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
  const diff = resultObj?.diff;
  const hasDiff: boolean = !!(diff && typeof diff === 'object' && Array.isArray((diff as DiffShape).hunks));

  const formattedArgs = formatValue(args);
  const formattedResult = formatValue(result);

  return (
    <details
      className={`tool-call-card${running ? ' is-running' : ''}${failed ? ' is-error' : ''}`}
    >
      <summary>
        <span className="tool-call-icon">{toolIcon(toolName)}</span>
        <span className="tool-call-action">{actionLabel}</span>
        {summaryHint && (
          <span className="tool-call-hint">{summaryHint}</span>
        )}
        <span className={`tool-call-status${running ? ' running' : ''}${failed ? ' error' : ''}`}>
          {statusWord}
        </span>
        {/* 失败摘要必须放在 summary 内:details 折叠时只渲染 summary,
            放在外面的话未展开状态看不到错误原因(违反 F15) */}
        {failed && errorSummary && (
          <span className="tool-call-errline">{errorSummary}</span>
        )}
      </summary>
      <div className="tool-call-body">
        {hasDiff && <DiffView diff={diff as DiffShape} />}
        {formattedArgs && (
          <>
            <div className="tool-call-section">参数</div>
            <pre className="tool-call-pre">{formattedArgs}</pre>
          </>
        )}
        {!hasDiff && formattedResult && (
          <>
            <div className="tool-call-section">结果</div>
            <pre className="tool-call-pre">{formattedResult}</pre>
          </>
        )}
      </div>
    </details>
  );
}
