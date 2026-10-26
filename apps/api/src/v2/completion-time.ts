import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2Task } from '@ntfs/contracts';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { periodWindow } from './calendar.js';

/** 完成时间不得越过创建、最近开始/重开或改派；系统顺延记录不构成补录时间下限。 */
export async function reconcileCompletion(manager: EntityManager, previous: V2Task | null, next: V2Task, now: string): Promise<void> {
  if (next.status !== 'completed' || !next.completedAt || previous?.completedAt === next.completedAt) return;
  if (next.completedAt > now || next.completedAt < next.createdAt) throw new ConflictException('完成时间不能早于任务创建，也不能晚于当前时间。');
  const repository = new V2TaskRepository(manager);
  const history = previous ? await repository.history([next.id]) : [];
  let lower = previous && previous.executorId !== next.executorId ? now : next.createdAt;
  for (const [index, event] of history.entries()) {
    const prior = history[index - 1];
    if (((event.action === 'status_changed' && event.snapshot.status !== 'completed') || (prior && prior.snapshot.executorId !== event.snapshot.executorId)) && event.occurredAt > lower) lower = event.occurredAt;
  }
  if (next.completedAt < lower) throw new ConflictException('完成时间不能早于最近一次开始、重开或改派时间。');
  if (next.kind !== 'project') return;

  // 补录只撤销完成时间之后且未经人工修改的顺延，手工安排和文本不被静默删除。
  const completedAt = next.completedAt;
  const periods = await new V2PlanningRepository(manager).periods(next.teamId);
  const rows = await repository.arrangements([next.id]);
  const redundant = rows.filter((row) => row.carriedFromPeriodId && periods.some((period) => period.id === row.periodId && periodWindow(period).start > completedAt));
  if (redundant.some((row) => row.version > 0 || row.workNote)) throw new ConflictException('完成时间之后的自动顺延已被人工修改，请先核对并取消相关排期，再补录完成时间。');
  for (const row of redundant) await repository.removeArrangement(next.id, row.periodId, now, true);
}
