import type { V2TaskReminderPlan } from './v2.js';

const day = 86_400_000;
export const v2TaskReminderReason = '定时提醒';

/** 计算严格晚于该时刻的提醒，按北京时间固定在同一个钟点。 */
export function upcomingTaskReminders(plan: V2TaskReminderPlan, after: number) {
  const last = Date.parse(`${plan.on}T${plan.time}:00+08:00`);
  const total = plan.mode === 'daily' ? plan.advanceDays + 1 : 1;
  const count = Math.max(0, Math.min(total, Math.ceil((last - after) / day)));
  const first = count > 0 ? last - (count - 1) * day : null;
  return { first, last, count, elapsed: total - count };
}

/** 从预览首日开始偏移，保持每日相同的北京时间。 */
export function taskReminderDay(first: number, offset: number): number {
  return first + offset * day;
}
