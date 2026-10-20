import type { V2ArrangementHistory, V2Period, V2TaskEvent } from '@ntfs/contracts';
import { periodWindow } from './calendar.js';

/** 计划外仅指本期直接新建且首次安排到本期的突发工作；执行偏离和待建转换不算。 */
export function classifyPlanning(period: V2Period, events: V2TaskEvent[], arrangements: V2ArrangementHistory[]): 'planned' | 'unplanned' | 'unknown' {
  const first = [...events].sort((a, b) => a.sequence - b.sequence)[0];
  if (!first || first.action !== 'created') return 'unknown';
  if (first.fromBacklog) return 'planned';
  const initial = arrangements.filter((row) => row.taskId === first.taskId && row.provenance === 'scheduled').sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
  if (!initial) return 'unknown';
  const window = periodWindow(period);
  return initial.periodId === period.id && first.occurredAt >= window.start && first.occurredAt < window.endExclusive ? 'unplanned' : 'planned';
}
