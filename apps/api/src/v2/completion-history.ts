import type { V2TaskEvent } from '@ntfs/contracts';

/** 实际完成时间用于业务回看，操作时刻仍保留在原始事件中。每次重开划分新的完成轮次。 */
export function completionTimeline(events: V2TaskEvent[]): V2TaskEvent[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const states: V2TaskEvent[] = [];
  for (const event of ordered) {
    if (event.action === 'completion_corrected') {
      const last = states.at(-1);
      if (last?.snapshot.status === 'completed' && event.snapshot.completedAt) {
        states[states.length - 1] = { ...last, occurredAt: event.snapshot.completedAt, snapshot: { ...last.snapshot, completedAt: event.snapshot.completedAt, actualDays: event.snapshot.actualDays, aiContribution: event.snapshot.aiContribution } };
      }
    } else if (['created', 'migrated', 'status_changed'].includes(event.action)) {
      states.push(event.snapshot.status === 'completed' && event.snapshot.completedAt ? { ...event, occurredAt: event.snapshot.completedAt } : event);
    }
  }
  return states.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence);
}

/** 名称与归属仍取截止时快照，只有显式完成补录允许纠正历史状态，不改写审计记录。 */
export function taskEventAt(events: V2TaskEvent[], endExclusive: string): V2TaskEvent | undefined {
  const base = [...events].filter((event) => event.occurredAt < endExclusive).sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!base) return undefined;
  const state = completionTimeline(events).filter((event) => event.occurredAt < endExclusive).at(-1);
  if (!state) return base;
  return { ...base, snapshot: { ...base.snapshot, status: state.snapshot.status, completedAt: state.snapshot.completedAt } };
}
