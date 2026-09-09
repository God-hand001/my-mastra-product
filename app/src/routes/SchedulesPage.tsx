import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cronToText } from '../lib/cron';
import {
  createSchedule,
  listSchedules,
  pauseSchedule,
  removeSchedule,
  resumeSchedule,
  runScheduleNow,
  type ScheduleView,
} from '../lib/schedulesClient';

// 调度类型(对齐千问:一次性 / 固定间隔 / Cron 表达式)
type ScheduleType = 'once' | 'interval' | 'cron';

const TYPE_LABELS: Record<ScheduleType, string> = {
  once: '一次性',
  interval: '固定间隔',
  cron: 'Cron 表达式',
};

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ScheduleType>('cron');
  const [at, setAt] = useState('');
  const [everyN, setEveryN] = useState(30);
  const [everyUnit, setEveryUnit] = useState<'minutes' | 'hours'>('minutes');
  const [cron, setCron] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) {
      setError('请输入任务名称');
      return;
    }
    if (!description.trim()) {
      setError('请输入任务描述');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await createSchedule({
        name: name.trim(),
        description: description.trim(),
        type,
        at: type === 'once' ? (at ? new Date(at).toISOString() : undefined) : undefined,
        everyN: type === 'interval' ? everyN : undefined,
        everyUnit: type === 'interval' ? everyUnit : undefined,
        cron: type === 'cron' ? cron : undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sched-form">
      <div className="sched-form-title-row">
        <span className="sched-form-heading">新建定时任务</span>
        <span className="sched-form-sub">自动化执行周期性 AI 代理工作</span>
      </div>
      <label className="sched-field">
        <span className="sched-field-label">
          任务名称<span className="sched-req">*</span>
        </span>
        <input
          className="sched-input"
          placeholder="请输入任务名称,如:每日早报"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </label>
      <label className="sched-field">
        <span className="sched-field-label">
          任务描述<span className="sched-req">*</span>
        </span>
        <textarea
          className="sched-input sched-textarea"
          placeholder="描述要让 AI 做什么,如:汇报当前时间,并总结今天的一条科技新闻"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </label>
      <div className="sched-field">
        <span className="sched-field-label">调度类型</span>
        <div className="sched-seg">
          {Object.entries(TYPE_LABELS).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`sched-seg-btn${type === v ? ' is-active' : ''}`}
              onClick={() => setType(v as ScheduleType)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sched-form-row">
        {type === 'once' && (
          <label className="sched-field">
            <span className="sched-field-label">执行时间</span>
            <input
              type="datetime-local"
              className="sched-input"
              value={at}
              onChange={e => setAt(e.target.value)}
            />
          </label>
        )}
        {type === 'interval' && (
          <>
            <label className="sched-field">
              <span className="sched-field-label">执行间隔</span>
              <div className="sched-input-group">
                <input
                  type="number"
                  min={1}
                  className="sched-input"
                  style={{ width: 96 }}
                  value={everyN}
                  onChange={e => setEveryN(Number(e.target.value))}
                />
                <select
                  className="sched-input"
                  value={everyUnit}
                  onChange={e => setEveryUnit(e.target.value as 'minutes' | 'hours')}
                >
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                </select>
              </div>
            </label>
          </>
        )}
        {type === 'cron' && (
          <label className="sched-field sched-field-grow">
            <span className="sched-field-label">Cron 表达式</span>
            <input
              className="sched-input"
              placeholder="0 9 * * 1-5"
              value={cron}
              onChange={e => setCron(e.target.value)}
            />
          </label>
        )}
      </div>
      {error && <div className="sched-error">{error}</div>}
      <div className="sched-form-actions">
        <button type="button" className="sched-btn" onClick={onDone}>
          取消
        </button>
        <button
          type="button"
          className="sched-btn-primary"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  );
}

export function SchedulesPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(() => {
    listSchedules()
      .then(setSchedules)
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="sched-page">
      <div className="sched-header">
        <div>
          <h2 className="sched-title">定时任务</h2>
          <div className="sched-subtitle">创建定时任务来自动化执行周期性 AI 代理工作</div>
        </div>
        <button className="sched-new-btn" onClick={() => setFormOpen(o => !o)}>
          {formOpen ? '收起' : '+ 新建定时任务'}
        </button>
      </div>

      {formOpen && (
        <ScheduleForm
          onDone={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      )}

      {error && <div className="sched-error">{error}</div>}

      {schedules === null ? (
        <div className="sched-empty">
          <div className="sched-empty-icon">⏰</div>
          加载中…
        </div>
      ) : schedules.length === 0 ? (
        <div className="sched-empty">
          <div className="sched-empty-icon">⏰</div>
          还没有定时任务
          <div className="sched-empty-sub">
            点右上角「新建定时任务」创建,或直接在对话里说"每天 9 点帮我做××"
          </div>
        </div>
      ) : (
        <div className="sched-list">
          {schedules.map(s => {
            const paused = s.status === 'paused';
            return (
              <div key={s.id} className="sched-card">
                <div className="sched-card-main">
                  <div className="sched-card-title-row">
                    <span className="sched-card-title">{s.name || s.prompt}</span>
                    <span className={`sched-status${paused ? ' is-paused' : ''}`}>
                      {paused ? '已停用' : '启用中'}
                    </span>
                  </div>
                  <div className="sched-card-meta">
                    <span>⏱ {cronToText(s.cron)}</span>
                    {!paused && s.nextFireAt && (
                      <span>
                        🕐 下次 {new Date(s.nextFireAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="sched-card-actions">
                  {s.threadId && (
                    <button
                      className="sched-icon-btn"
                      title="查看执行历史"
                      onClick={() => navigate(`/task/${s.threadId}`)}
                    >
                      📜
                    </button>
                  )}
                  <button
                    className="sched-icon-btn"
                    title="立即执行一次"
                    onClick={() => void act(() => runScheduleNow(s.id))}
                  >
                    ▶
                  </button>
                  <button
                    className={`sched-switch${paused ? '' : ' is-on'}`}
                    title={paused ? '启用调度' : '停用调度'}
                    onClick={() =>
                      void act(() => (paused ? resumeSchedule(s.id) : pauseSchedule(s.id)))
                    }
                  >
                    <span className="sched-switch-knob" />
                  </button>
                  <button
                    className="sched-icon-btn sched-icon-danger"
                    title="删除"
                    onClick={() => void act(() => removeSchedule(s.id))}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
