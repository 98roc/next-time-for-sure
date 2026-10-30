import { v2PeriodWindowCountsSchema, type V2Period } from '@ntfs/contracts';
import { naturalWeek, shiftDate } from './calendar.js';

type PeriodDates = Pick<V2Period, 'startOn' | 'endOn'>;

/** 只规划两端缺少的空区间，保留人工边界；调用方在组织锁内一次落库。 */
export function missingWindowPeriods(existing: PeriodDates[], today: string, counts: { before: number; after: number }): PeriodDates[] {
  v2PeriodWindowCountsSchema.parse(counts);
  const periods = [...existing].sort((a, b) => a.startOn.localeCompare(b.startOn));
  const added: PeriodDates[] = [];
  if (!periods.length) { const week = naturalWeek(today); periods.push(week); added.push(week); }

  function append() {
    const edge = periods.at(-1);
    if (!edge) throw new Error('日期目录为空');
    const next = { startOn: shiftDate(edge.endOn, 1), endOn: shiftDate(edge.endOn, 7) };
    periods.push(next); added.push(next);
  }
  function prepend() {
    const edge = periods[0];
    if (!edge) throw new Error('日期目录为空');
    const previous = { startOn: shiftDate(edge.startOn, -7), endOn: shiftDate(edge.startOn, -1) };
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
