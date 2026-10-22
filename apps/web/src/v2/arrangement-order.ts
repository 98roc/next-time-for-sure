import type { V2ArrangementInput, V2Period } from '@ntfs/contracts';

/** 按真实日期排列任务周期，不使用入口区间或周期内任务位置；返回副本以保留编辑草稿顺序。 */
export function orderArrangements<T extends V2ArrangementInput>(rows: readonly T[], periods: readonly V2Period[]): T[] {
  const dates = new Map(periods.map((period) => [period.id, period.startOn]));
  return [...rows].sort((a, b) => (dates.get(a.periodId) ?? '9999').localeCompare(dates.get(b.periodId) ?? '9999') || a.periodId.localeCompare(b.periodId));
}
