import { useEffect, useRef, useState } from 'react';
import type { ReasoningMessagePartProps } from '@assistant-ui/react';

// 实测 deepseek 不吐 reasoning（sendReasoning 开启后已实测流出），本组件为完整契约实现。
// 历史消息的 reasoning part 无 status 字段，只显示"已深度思考"，不显示耗时。
export function ReasoningBlock({ text, status }: ReasoningMessagePartProps) {
  const running = status?.type === 'running';
  const startRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // hooks 必须无条件调用:不能在条件 return 之后使用,否则 text 从空变非空时
  // hooks 数量改变,React 会直接崩溃(违反 Rules of Hooks)
  useEffect(() => {
    if (running && startRef.current === null) {
      // 首次观测到 running 时记下开始时间
      startRef.current = Date.now();
    } else if (!running && startRef.current !== null) {
      // 状态变为非 running 时结算本组件观测到的运行时长
      const ms = Date.now() - startRef.current;
      setElapsedSec(Math.max(1, Math.round(ms / 1000)));
      startRef.current = null;
    }
  }, [running]);

  // 流式期间自动滚到最新输出,不需要用户手动下滑(2026-09-18 用户反馈)
  useEffect(() => {
    const el = bodyRef.current;
    if (running && el) el.scrollTop = el.scrollHeight;
  }, [text, running]);

  // text 为空字符串且非运行中：模型无推理时不出现空区块
  if (text === '' && !running) {
    return null;
  }

  // 历史消息无 status 字段，不显示耗时
  const summaryText = running
    ? '深度思考中…'
    : status === undefined
      ? '已深度思考'
      : `已深度思考 · ${elapsedSec ?? 1} 秒`;

  return (
    <details className="reasoning-block" open={running}>
      <summary>
        {running && <span className="tool-card-spinner" />}
        <span>{summaryText}</span>
      </summary>
      <div className="reasoning-body" ref={bodyRef}>{text}</div>
    </details>
  );
}
