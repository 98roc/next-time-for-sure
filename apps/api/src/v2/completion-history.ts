import type { V2TaskEvent } from '@ntfs/contracts';

/** 实际完成时间用于业务回看，操作时刻仍保留在原始事件中。每次重开划分新的完成轮次。 */
export function completionTimeline(events: V2TaskEvent[]): V2TaskEvent[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const states: V2TaskEvent[] = [];
  for (const event of ordered) {
    if (event.action === 'completion_corrected') {
      const last = states.at(-1);
      if (last?.snapshot.status === 'completed' && event.snapshot.completedAt) {
        states[states.length - 1] = { ...last, occurredAt: event.snapshot.completedAt, snapshot: { ...last.snapshot, startedAt: event.snapshot.startedAt, completedAt: event.snapshot.completedAt, actualDays: event.snapshot.actualDays, aiContribution: event.snapshot.aiContribution } };
      }
    } else if (['created', 'migrated', 'status_changed'].includes(event.action)) {
      states.push(event.snapshot.status === 'completed' && event.snapshot.completedAt ? { ...event, occurredAt: event.snapshot.completedAt } : event);
    }
  }
  // 补录可以早于系统开始或创建；这些较晚的系统事件不能把已补录完成反推为进行中。
  return states.filter((event, index) => event.snapshot.status === 'completed' || !states.slice(index + 1).some((later) => later.snapshot.status === 'completed' && later.occurredAt <= event.occurredAt)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence);
}

/** 名称与归属仍取截止时快照，只有显式完成补录允许纠正历史状态，不改写审计记录。 */
export function taskEventAt(events: V2TaskEvent[], endExclusive: string): V2TaskEvent | undefined {
  const base = [...events].filter((event) => event.occurredAt < endExclusive).sort((a, b) => a.sequence - b.sequence).at(-1);
  const state = completionTimeline(events).filter((event) => event.occurredAt < endExclusive).sort((a, b) => a.sequence - b.sequence).at(-1);
  // 晚建任务在完成当日尚无系统快照，使用显式补录的完成快照，不推测其他历史字段。
  if (!base) return state?.snapshot.status === 'completed' ? state : undefined;
  if (!state) return base;
  return { ...base, snapshot: { ...base.snapshot, status: state.snapshot.status, startedAt: state.snapshot.startedAt, completedAt: state.snapshot.completedAt } };
}
