import { useState } from 'react';
import { API_BASE } from '../lib/apiBase';
import { markDecidedLocally, markThreadResuming } from './SandboxApprovalCard';

export interface AskUserQuestion {
  id: string;
  title: string;
  hint?: string;
  type: 'single' | 'multi' | 'text';
  options?: Array<{ label: string; description?: string }>;
  allowCustom?: boolean;
}

interface AskUserPanelProps {
  threadId: string;
  data: {
    runId: string;
    toolCallId: string;
    questions: AskUserQuestion[];
  };
  onSubmitted: () => void;
}

// 收集中的答案:text/单选为字符串,多选为字符串数组。
type AnswerValue = string | string[];

function isQuestionAnswered(value: AnswerValue | undefined, type: AskUserQuestion['type']): boolean {
  if (value == null) return false;
  if (type === 'text') return typeof value === 'string' && value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' && value.length > 0;
}

export function AskUserPanel({ threadId, data, onSubmitted }: AskUserPanelProps) {
  const { runId, toolCallId, questions } = data;
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [touched, setTouched] = useState(false);

  const allAnswered = questions.every(q => isQuestionAnswered(answers[q.id], q.type));

  const updateSingle = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const updateMulti = (questionId: string, label: string, checked: boolean) => {
    setAnswers(prev => {
      const current = prev[questionId];
      const arr = Array.isArray(current) ? current : [];
      const next = checked ? [...arr, label] : arr.filter(item => item !== label);
      return { ...prev, [questionId]: next };
    });
  };

  const updateText = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const buildFinalAnswers = (): Record<string, AnswerValue> => {
    const out: Record<string, AnswerValue> = {};
    for (const q of questions) {
      const raw = answers[q.id];
      if (q.type === 'text') {
        out[q.id] = typeof raw === 'string' ? raw.trim() : '';
        continue;
      }
      if (q.type === 'single') {
        const selected = typeof raw === 'string' ? raw : '';
        if (q.allowCustom && selected === '__custom__') {
          out[q.id] = (custom[q.id] ?? '').trim();
        } else {
          out[q.id] = selected;
        }
        continue;
      }
      if (q.type === 'multi') {
        const arr = Array.isArray(raw) ? raw : [];
        if (q.allowCustom && arr.includes('__custom__')) {
          const customText = (custom[q.id] ?? '').trim();
          const filtered = arr.filter(item => item !== '__custom__');
          out[q.id] = customText ? [...filtered, customText] : filtered;
        } else {
          out[q.id] = arr;
        }
      }
    }
    return out;
  };

  const submit = async (skip: boolean) => {
    if (submitting || done) return;
    if (!skip && !allAnswered) {
      setTouched(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        threadId,
        runId,
        toolCallId,
        skip,
      };
      if (!skip) {
        body.answers = buildFinalAnswers();
      }
      const res = await fetch(`${API_BASE}/ask-user/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = (await res.json().catch(() => ({ error: '无法解析后端响应' }))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || resBody.ok !== true) {
        throw new Error(resBody.error ?? `请求失败(${res.status})`);
      }
      // 请求成功后再落本地抑制标记:失败时允许用户重试
      markDecidedLocally(runId, toolCallId);
      // 进入续跑中状态,联动对话区状态行与计时
      markThreadResuming(threadId);
      setDone(true);
      // 延迟通知父组件:"✓ 已提交"提示至少停留一会儿再关闭标签,
      // 否则父组件会在同一渲染帧里把这个问题从队列移除,用户完全看不到
      // 提交成功的反馈,直接跳到"暂无等待回答的问题"的空态(2026-09-20 用户实测发现)。
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
        <div className="askuser-done">✓ 已提交,AI 正在按你的回答继续</div>
      </div>
    );
  }

  return (
    <div className="askuser-panel">
      <div className="askuser-head">
        <span className="askuser-title">需要补充一些信息</span>
        <span className="askuser-hint">请回答以下问题,帮助 AI 更准确地完成任务</span>
      </div>
      <div className="askuser-questions">
        {questions.map((q, index) => (
          <div key={q.id} className="askuser-question">
            <div className="askuser-question-title">
              <span className="askuser-question-index">{index + 1}</span>
              {q.title}
            </div>
            {q.hint && <div className="askuser-question-hint">{q.hint}</div>}
            {q.type === 'text' && (
              <textarea
                className="askuser-textarea"
                rows={4}
                value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                onChange={e => updateText(q.id, e.target.value)}
                placeholder="请输入你的回答…"
              />
            )}
            {q.type === 'single' && (
              <div className="askuser-options">
                {(q.options ?? []).map(opt => (
                  <label key={opt.label} className="askuser-option">
                    <input
                      type="radio"
                      name={q.id}
                      value={opt.label}
                      checked={answers[q.id] === opt.label}
                      onChange={() => updateSingle(q.id, opt.label)}
                    />
                    <span className="askuser-option-text">
                      <span className="askuser-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="askuser-option-description">{opt.description}</span>
                      )}
                    </span>
                  </label>
                ))}
                {q.allowCustom && (
                  <label className="askuser-option">
                    <input
                      type="radio"
                      name={q.id}
                      value="__custom__"
                      checked={answers[q.id] === '__custom__'}
                      onChange={() => updateSingle(q.id, '__custom__')}
                    />
                    <span className="askuser-option-text">
                      <span className="askuser-option-label">其他</span>
                      <input
                        type="text"
                        className="askuser-custom-input"
                        value={custom[q.id] ?? ''}
                        onChange={e => setCustom(prev => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="请填写…"
                        disabled={answers[q.id] !== '__custom__'}
                      />
                    </span>
                  </label>
                )}
              </div>
            )}
            {q.type === 'multi' && (
              <div className="askuser-options">
                {(q.options ?? []).map(opt => (
                  <label key={opt.label} className="askuser-option">
                    <input
                      type="checkbox"
                      value={opt.label}
                      checked={Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt.label)}
                      onChange={e => updateMulti(q.id, opt.label, e.target.checked)}
                    />
                    <span className="askuser-option-text">
                      <span className="askuser-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="askuser-option-description">{opt.description}</span>
                      )}
                    </span>
                  </label>
                ))}
                {q.allowCustom && (
                  <label className="askuser-option">
                    <input
                      type="checkbox"
                      value="__custom__"
                      checked={Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes('__custom__')}
                      onChange={e => updateMulti(q.id, '__custom__', e.target.checked)}
                    />
                    <span className="askuser-option-text">
                      <span className="askuser-option-label">其他</span>
                      <input
                        type="text"
                        className="askuser-custom-input"
                        value={custom[q.id] ?? ''}
                        onChange={e => setCustom(prev => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="请填写…"
                        disabled={!Array.isArray(answers[q.id]) || !(answers[q.id] as string[]).includes('__custom__')}
                      />
                    </span>
                  </label>
                )}
              </div>
            )}
            {touched && !isQuestionAnswered(answers[q.id], q.type) && (
              <div className="askuser-error-inline">请回答本题</div>
            )}
          </div>
        ))}
      </div>
      <div className="askuser-actions">
        <button
          type="button"
          className="approval-option is-primary"
          disabled={submitting}
          onClick={() => submit(false)}
        >
          提交答案
        </button>
        <button
          type="button"
          className="approval-option"
          disabled={submitting}
          onClick={() => submit(true)}
        >
          AI 自行决定
        </button>
      </div>
      {error && <div className="approval-card-error">后端错误: {error}</div>}
    </div>
  );
}