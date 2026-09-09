import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cronToText,
  buildCron,
  type FrequencyPreset,
} from '../lib/cron';
import {
  createSchedule,
  listSchedules,
  pauseSchedule,
  removeSchedule,
  resumeSchedule,
  runScheduleNow,
  type ScheduleView,
} from '../lib/schedulesClient';
import { useTaskStore } from '../lib/taskStore';

const PRESET_LABELS: Record<FrequencyPreset, string> = {
  daily: '每天',
  weekly: '每周',
  workday: '工作日',
  monthly: '每月',
  custom: '自定义 cron',
};

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const { refresh: refreshTasks } = useTaskStore();
  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState<FrequencyPreset>('daily');
  const [time, setTime] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthDay, setMonthDay] = useState(1);
  const [customCron, setCustomCron] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim()) {
      setError('请填写任务描述');
      return;
    }
    const cron = buildCron({ preset, time, weekdays, monthDay, customCron });
    if (!cron) {
      setError(preset === 'weekly' ? '请选择星期' : preset === 'monthly' ? '请选择几号' : '请填写 cron 或时间');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await createSchedule({ title: title.trim(), prompt: title.trim(), cron });
      // 后端创建时同时生成关联线程，立即同步到左侧任务列表。
      await refreshTasks();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sched-form">
      <input
        className="sched-form-title"
        placeholder="任务描述,如:每天早上汇报科技新闻"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <div className="sched-form-row">
        <select
          className="sched-form-select"
          value={preset}
          onChange={e => setPreset(e.target.value as FrequencyPreset)}
        >
          {Object.entries(PRESET_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>

        {preset === 'weekly' && (
          <div className="sched-form-weekdays">
            {[1, 2, 3, 4, 5, 6, 0].map(d => (
              <button
                key={d}
                type="button"
                className={`sched-wd${weekdays.includes(d) ? ' is-on' : ''}`}
                onClick={() =>
                  setWeekdays(prev =>
                    prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d],
                  )
                }
              >
                {['日', '一', '二', '三', '四', '五', '六'][d]}
              </button>
            ))}
          </div>
        )}
        {preset === 'monthly' && (
          <input
            type="number"
            min={1}
            max={31}
            className="sched-form-monthday"
            value={monthDay}
            onChange={e => setMonthDay(Number(e.target.value))}
          />
        )}
        {preset === 'custom' ? (
          <input
            className="sched-form-cron"
            placeholder="cron 表达式,如 0 9 * * *"
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
          />
        ) : (
          <input
            type="time"
            className="sched-form-time"
            value={time}
            onChange={e => setTime(e.target.value)}
          />
        )}

        <button type="button" className="sched-form-submit" disabled={submitting} onClick={() => void submit()}>
          {submitting ? '创建中…' : '创建'}
        </button>
      </div>
      {error && <div className="sched-error">{error}</div>}
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
        <h2 className="sched-title">定时任务</h2>
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
        <div className="sched-empty">加载中…</div>
      ) : schedules.length === 0 ? (
        <div className="sched-empty">
          还没有定时任务,点上方按钮创建,或直接在对话里说"每天 9 点帮我做××"
        </div>
      ) : (
        <div className="sched-list">
          {schedules.map(s => (
            <div key={s.id} className="sched-item">
              <div className="sched-item-main">
                <div className="sched-item-title">{s.name || s.prompt}</div>
                <div className="sched-item-meta">
                  {cronToText(s.cron)} · {s.status === 'paused' ? '已暂停' : '运行中'}
                  {s.status !== 'paused' && s.nextFireAt
                    ? ` · 下次 ${new Date(s.nextFireAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </div>
              </div>
              <div className="sched-item-actions">
                {s.threadId && (
                  <button
                    className="sched-item-btn"
                    title="查看执行历史"
                    onClick={() => navigate(`/task/${s.threadId}`)}
                  >
                    历史
                  </button>
                )}
                <button
                  className="sched-item-btn"
                  title="立即执行一次"
                  onClick={() => void act(() => runScheduleNow(s.id))}
                >
                  ▶ 立即执行
                </button>
                <button
                  className={`sched-switch${s.status === 'paused' ? '' : ' is-on'}`}
                  title={s.status === 'paused' ? '恢复调度' : '暂停调度'}
                  onClick={() =>
                    void act(() =>
                      s.status === 'paused' ? resumeSchedule(s.id) : pauseSchedule(s.id),
                    )
                  }
                >
                  <span className="sched-switch-knob" />
                </button>
                <button
                  className="sched-item-btn sched-item-delete"
                  title="删除"
                  onClick={() => void act(() => removeSchedule(s.id))}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
