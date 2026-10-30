import { v2PeriodWindowCountsSchema } from './v2-workspace.js';
import { v2DateSchema, type V2Period } from './v2.js';

type PeriodDates = Pick<V2Period, 'startOn' | 'endOn'>;

/** 前端预览与后端创建共用两端补齐规则；不生成业务ID、不修改输入，实际落库由后端事务承接。 */
export function missingPeriodWindowDates(existing: readonly PeriodDates[], today: string, counts: { before: number; after: number }): PeriodDates[] {
  v2PeriodWindowCountsSchema.parse(counts);
  const periods = [...existing].sort((a, b) => a.startOn.localeCompare(b.startOn));
  const added: PeriodDates[] = [];
  if (!periods.length) { const week = naturalPeriodWeek(today); periods.push(week); added.push(week); }

  function append() {
    const edge = periods.at(-1);
    if (!edge) throw new Error('日期目录为空');
    const next = { startOn: shiftPeriodDate(edge.endOn, 1), endOn: shiftPeriodDate(edge.endOn, 7) };
    periods.push(next); added.push(next);
  }
  function prepend() {
    const edge = periods[0];
    if (!edge) throw new Error('日期目录为空');
    const previous = { startOn: shiftPeriodDate(edge.startOn, -7), endOn: shiftPeriodDate(edge.startOn, -1) };
    periods.unshift(previous); added.push(previous);
  }

  // 长期停运或已有目录全在未来时，先补到包含今天，再按实际区间计数。
  while ((periods.at(-1)?.endOn ?? today) < today) append();
  while ((periods[0]?.startOn ?? today) > today) prepend();
  let current = periods.findIndex((period) => period.startOn <= today && period.endOn >= today);
  if (current < 0) throw new Error('日期目录不连续，无法定位当前区间');
  while (current < counts.before) { prepend(); current++; }
  // 即使窗口只显示当前区间，也保留周报双栏需要的下一区间。
  while (periods.length - current - 1 < Math.max(1, counts.after)) append();
  return added.sort((a, b) => a.startOn.localeCompare(b.startOn));
}

/** 对经过校验的纯日期加减天数，避免夏令时及本机时区影响。 */
export function shiftPeriodDate(value: string, days: number): string {
  v2DateSchema.parse(value);
  if (!Number.isInteger(days)) throw new Error('天数必须为整数');
  return v2DateSchema.parse(new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10));
}

/** 自然周仅是初始生成方式；现存区间的相邻关系由保存顺序决定。 */
export function naturalPeriodWeek(on: string): PeriodDates {
  v2DateSchema.parse(on);
  const weekday = new Date(`${on}T00:00:00.000Z`).getUTCDay();
  const startOn = shiftPeriodDate(on, -((weekday + 6) % 7));
  return { startOn, endOn: shiftPeriodDate(startOn, 6) };
}
