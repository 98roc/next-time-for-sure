import { v2DateSchema, shiftPeriodDate as shiftDate, type V2Period } from '@ntfs/contracts';

export { shiftPeriodDate as shiftDate, naturalPeriodWeek as naturalWeek } from '@ntfs/contracts';

/** 团队当前固定上海时区，日期运算不依赖进程或浏览器所在时区。 */
export function shanghaiDate(instant: string): string {
  const timestamp = new Date(instant).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('无效时间');
  return new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 包含起止日期的业务区间转换为半开 UTC 时间窗，毫秒边界不丢失事件。 */
export function periodWindow(period: Pick<V2Period, 'startOn' | 'endOn'>): { start: string; endExclusive: string } {
  v2DateSchema.parse(period.startOn); v2DateSchema.parse(period.endOn);
  if (period.startOn > period.endOn) throw new Error('区间日期倒置');
  return { start: new Date(`${period.startOn}T00:00:00.000+08:00`).toISOString(), endExclusive: new Date(`${shiftDate(period.endOn, 1)}T00:00:00.000+08:00`).toISOString() };
}

/** 整批校验日期调整，历史锁定和连续性检查必须在写事务中针对最新记录执行。 */
export function validatePeriodChanges(current: V2Period[], proposed: V2Period[], today: string): void {
  v2DateSchema.parse(today);
  const old = new Map(current.map((period) => [period.id, period]));
  const ordered = [...proposed].sort((a, b) => a.startOn.localeCompare(b.startOn));
  if (new Set(ordered.map((period) => period.id)).size !== ordered.length) throw new Error('日期区间不能重复');
  if (current.some((period) => !ordered.some((next) => next.id === period.id))) throw new Error('日期调整不能删除现有区间');
  for (let index = 0; index < ordered.length; index++) {
    const period = ordered[index];
    if (!period) continue;
    periodWindow(period);
    const previous = ordered[index - 1];
    if (previous && (previous.teamId !== period.teamId || shiftDate(previous.endOn, 1) !== period.startOn)) throw new Error('同一团队区间必须连续且不重叠');
    const original = old.get(period.id);
    if (original && (original.teamId !== period.teamId || original.version !== period.version)) throw new Error('日期区间已变化，请重新预览');
    if (original && original.endOn < today && (original.startOn !== period.startOn || original.endOn !== period.endOn)) throw new Error('已结束区间日期不可修改');
    if (!original && current.length && ordered.some((entry) => old.has(entry.id) && entry.startOn < period.startOn) && ordered.some((entry) => old.has(entry.id) && entry.startOn > period.startOn)) throw new Error('只能在已有日期范围两端补齐区间');
  }
}
