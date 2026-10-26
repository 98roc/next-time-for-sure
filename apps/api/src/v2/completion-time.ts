import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2Task } from '@ntfs/contracts';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { periodWindow } from './calendar.js';

/** 起止时间允许早于创建、重开和改派，实际时间不能在未来，开始不能晚于完成。 */
export async function reconcileCompletion(manager: EntityManager, previous: V2Task | null, next: V2Task, now: string): Promise<void> {
  if (next.status !== 'completed' || !next.completedAt) return;
  if (previous?.completedAt === next.completedAt && previous?.startedAt === next.startedAt) return;
  validateExecutionTimes(next.startedAt, next.completedAt, now);
  if (previous?.completedAt === next.completedAt) return;
  const repository = new V2TaskRepository(manager);
  if (next.kind !== 'project') return;

  // 补录只撤销完成时间之后且未经人工修改的顺延，手工安排和文本不被静默删除。
  const completedAt = next.completedAt;
  const periods = await new V2PlanningRepository(manager).periods(next.teamId);
  const rows = await repository.arrangements([next.id]);
  const redundant = rows.filter((row) => row.carriedFromPeriodId && periods.some((period) => period.id === row.periodId && periodWindow(period).start > completedAt));
  if (redundant.some((row) => row.version > 0 || row.workNote)) throw new ConflictException('完成时间之后的自动顺延已被人工修改，请先核对并取消相关排期，再补录完成时间。');
  for (const row of redundant) await repository.removeArrangement(next.id, row.periodId, now, true);
}

/** 共用时间关系校验；缺少实际开始时间时不推测、不强制补录。 */
export function validateExecutionTimes(startedAt: string | null | undefined, completedAt: string, now: string): void {
  if (completedAt > now) throw new ConflictException('完成时间不能晚于当前时间。');
  if (startedAt && startedAt > now) throw new ConflictException('开始时间不能晚于当前时间。');
  if (startedAt && startedAt > completedAt) throw new ConflictException('开始时间不能晚于完成时间。');
}
