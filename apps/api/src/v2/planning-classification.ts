import type { V2Period } from '@ntfs/contracts';
import { periodWindow } from './calendar.js';

/** 仅在直接新建任务的首个安排省略标签时填默认值，保存后不再重新推断。 */
export function defaultUnplanned(period: V2Period, createdAt: string, fromBacklog: boolean): boolean {
  const window = periodWindow(period);
  return !fromBacklog && createdAt >= window.start && createdAt < window.endExclusive;
}
