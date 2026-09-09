// cron 表达式 → 人类可读描述(M3,文案规则对齐千问办公)

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** cron → 人类可读描述(对齐千问文案;不认识的形态原样) */
export function cronToText(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dayMon, month, dayWeek] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  // 固定间隔形态(千问"固定间隔"调度类型)
  const stepMin = /^\*\/(\d+)$/.exec(min);
  if (stepMin && hour === '*' && dayMon === '*' && dayWeek === '*') {
    return `每 ${Number(stepMin[1])} 分钟`;
  }
  const stepHour = /^\*\/(\d+)$/.exec(hour);
  if (stepHour && min === '0' && dayMon === '*' && dayWeek === '*') {
    return `每 ${Number(stepHour[1])} 小时`;
  }

  // 一次性形态(千问"一次性"调度类型:指定月/日/时/分)
  if (month !== '*' && dayMon !== '*') {
    return `一次性 ${Number(month)} 月 ${Number(dayMon)} 日 ${time}`;
  }

  // 循环形态
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
  if (schedule.status === 'paused') return '已停用';
  if (schedule.nextFireAt) {
    const d = new Date(schedule.nextFireAt);
    return `启用中 · 下次 ${d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  }
  return '启用中';
}
