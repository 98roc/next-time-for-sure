import type { V2Milestone, V2Status } from '@ntfs/contracts';

/** 使用服务端上海日期计算自然日差，避免浏览器时区和夏令时偏移。 */
export function deadlineText(date: string, today: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return days === 0 ? '今天截止' : days < 0 ? `已逾期 ${-days} 天` : `剩余 ${days} 天`;
}

/** 截止日期保持完整年份，已完成目标不再显示逾期警示。 */
export function Deadline({ date, today, completed = false, count = 0 }: { date: string; today: string; completed?: boolean; count?: number }) {
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return <div className={`v2-ms-deadline${!completed && date < today ? ' is-due' : ''}`}><time dateTime={date}><span>{date.slice(0, 4)} / </span><strong>{date.slice(5).replace('-', ' / ')}</strong></time><small>{week}{(!completed || count > 0) && ` · ${completed ? '本日目标已完成' : deadlineText(date, today)}`}{count > 1 && ` · ${count} 项目标`}</small></div>;
}

/** 状态同时使用符号和文字，颜色不承担唯一语义。 */
export function MilestoneStatus({ milestone }: { milestone: V2Milestone }) {
  return <span className={`v2-ms-status${milestone.status === 'completed' ? ' is-complete' : ''}`}>{milestone.status === 'completed' ? '已完成' : '未完成'}</span>;
}

/** 任务状态图标与旁边的状态文字并存，保持原型的圆点、空圈与完成标识。 */
export function MilestoneTaskIcon({ status }: { status: V2Status }) {
  return <svg className={`v2-ms-task-icon ${status}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" />{status === 'completed' ? <path d="m8 12 3 3 5-6" /> : status === 'in_progress' ? <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /> : null}</svg>;
}

/** 里程碑沿用原型的线性图标，避免系统字符在不同平台上改变尺寸。 */
export function MilestoneIcon({ name }: { name: 'history' | 'plus' | 'calendar' | 'calendar-plus' | 'calendar-date' | 'right' | 'down' | 'up' }) {
  return <svg className="v2-ms-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name === 'history' ? <path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2" /> : name === 'plus' ? <path d="M12 5v14M5 12h14" /> : name === 'right' ? <path d="m9 6 6 6-6 6" /> : name === 'down' ? <path d="m6 9 6 6 6-6" /> : name === 'up' ? <path d="m6 15 6-6 6 6" /> : name === 'calendar-date' ? <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></> : <><path d="M8 2v4M16 2v4M3 10h18M10 22H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />{name === 'calendar-plus' ? <path d="M18 15v8M14 19h8" /> : <><circle cx="17" cy="18" r="5" /><path d="M17 15v3l2 1" /></>}</>}
  </svg>;
}
