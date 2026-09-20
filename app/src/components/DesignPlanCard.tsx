import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';
import { markDecidedLocally, markThreadResuming } from './SandboxApprovalCard';

export interface DesignPlanArtifact {
  path: string;
  purpose: string;
}

export interface DesignPlanData {
  runId: string;
  toolCallId: string;
  plan: {
    abstract: string;
    artifacts: DesignPlanArtifact[];
  };
}

interface DesignPlanCardProps {
  threadId: string;
  data: DesignPlanData;
  onSubmitted: () => void;
}

// 设计计划确认卡(M16-T6):对齐 AskUserPanel 的提交/延迟关闭模式,
// 但按钮语义不同——不是"提交答案/AI自行决定",是"进入规划/直接执行"。
export function DesignPlanCard({ threadId, data, onSubmitted }: DesignPlanCardProps) {
  const { runId, toolCallId, plan } = data;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneLabel, setDoneLabel] = useState('');

  const submit = async (decision: 'approved' | 'direct') => {
    if (submitting || done) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/design-plan/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, runId, toolCallId, decision }),
      });
      const resBody = (await res.json().catch(() => ({ error: '无法解析后端响应' }))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || resBody.ok !== true) {
        throw new Error(resBody.error ?? `请求失败(${res.status})`);
      }
      markDecidedLocally(runId, toolCallId);
      markThreadResuming(threadId);
      setDoneLabel(decision === 'approved' ? '✓ 计划已确认,AI 正在按计划生成' : '✓ 已选择直接执行,AI 正在生成');
      setDone(true);
      setTimeout(onSubmitted, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="askuser-panel">
        <div className="askuser-done">{doneLabel}</div>
      </div>
    );
  }

  return (
    <div className="askuser-panel">
      <div className="askuser-head">
        <span className="askuser-title">设计计划</span>
        <span className="askuser-hint">确认后 AI 将按计划生成产物;也可以跳过规划直接执行</span>
      </div>
      <div className="design-plan-abstract">{plan.abstract}</div>
      <div className="design-plan-artifacts">
        {plan.artifacts.map((a, i) => (
          <div key={i} className="design-plan-artifact-row">
            <span className="design-plan-artifact-path">{a.path}</span>
            <span className="design-plan-artifact-purpose">{a.purpose}</span>
          </div>
        ))}
      </div>
      <div className="askuser-actions">
        <button type="button" className="approval-option is-primary" disabled={submitting} onClick={() => submit('approved')}>进入规划</button>
        <button type="button" className="approval-option" disabled={submitting} onClick={() => submit('direct')}>直接执行</button>
      </div>
      {error && <div className="approval-card-error">后端错误: {error}</div>}
    </div>
  );
}