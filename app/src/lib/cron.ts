// cron 表达式与表单预设的互转(M3 F2/F4)

export type FrequencyPreset = 'daily' | 'weekly' | 'workday' | 'monthly' | 'custom';

export interface CronForm {
  preset: FrequencyPreset;
  time: string; // "HH:mm"
  weekdays: number[]; // 0=周日 1=周一 … 6(每周 preset 用)
  monthDay: number; // 1~31(每月 preset 用)
  customCron: string; // 自定义 preset 用
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 表单 → cron 表达式 */
export function buildCron(form: CronForm): string | null {
  const [hStr, mStr] = form.time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  switch (form.preset) {
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly': {
      if (form.weekdays.length === 0) return null;
      const days = [...form.weekdays].sort((a, b) => a - b).join(',');
      return `${m} ${h} * * ${days}`;
    }
    case 'workday':
      return `${m} ${h} * * 1-5`;
    case 'monthly': {
      if (!form.monthDay || form.monthDay < 1 || form.monthDay > 31) return null;
      return `${m} ${h} ${form.monthDay} * *`;
    }
    case 'custom':
      return form.customCron.trim() || null;
  }
}

/** cron → 人类可读描述(只翻译已知形态,自定义原样) */
export function cronToText(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dayMon, , dayWeek] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  // 判断顺序:每月 → 每天 → 工作日 → 指定星期 → 原样
  if (dayMon !== '*') return `每月 ${Number(dayMon)} 日 ${time}`;
  if (dayWeek === '*') return `每天 ${time}`;
  if (dayWeek === '1-5') return `工作日 ${time}`;
  if (/^\d+(,\d+)*$/.test(dayWeek)) {
    const names = dayWeek.split(',').map(d => WEEKDAY_NAMES[Number(d)] ?? d);
    return `${names.join('、')} ${time}`;
  }
  return cron;
}

/** 调度状态的可读展示 */
export function statusText(schedule: { status: string; nextFireAt?: number }): string {
  if (schedule.status === 'paused') return '已暂停';
  if (schedule.nextFireAt) {
    const d = new Date(schedule.nextFireAt);
    return `运行中 · 下次 ${d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  }
  return '运行中';
}
