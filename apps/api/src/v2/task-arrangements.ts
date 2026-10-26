import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2ArrangementInput, V2Task } from '@ntfs/contracts';
import type { V2Context } from './context.js';
import { canManageProject } from './permissions.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { requireConfirmation } from './impact.js';
import { shanghaiDate } from './calendar.js';

/** 估算修改不改变安排集合；日期增删另按管理权限及影响确认处理。 */
export function arrangementPeriodsChanged(previous: V2ArrangementInput[], next: V2ArrangementInput[]): boolean {
  return previous.length !== next.length || previous.some((row) => !next.some((item) => item.periodId === row.periodId));
}

/** 全量安排在任务事务中校验和保存，不逐次请求导致草稿部分落库。 */
export async function saveArrangements(manager: EntityManager, context: V2Context, task: V2Task, rows: V2ArrangementInput[], confirmation: string | undefined, now: string): Promise<void> {
  if (task.kind !== 'project') throw new ConflictException('私人任务不维护周期安排。');
  const repository = new V2TaskRepository(manager), previous = await repository.arrangements([task.id]);
  const periods = await new V2PlanningRepository(manager).periods(task.teamId);
  if (!rows.length || new Set(rows.map((row) => row.periodId)).size !== rows.length || rows.some((row) => !periods.some((period) => period.id === row.periodId))) throw new ConflictException('至少保留一个有效周期，日期区间不能重复。');
  if (arrangementPeriodsChanged(previous, rows)) {
    const project = context.projects.find((entry) => entry.id === task.projectId);
    if (!project || !canManageProject(context.actor, project)) throw new ForbiddenException('只有负责人可以调整周期安排；执行人可维护已有周期预计投入。');
    await requireConfirmation(manager, context, { action: 'save_arrangements', taskId: task.id, version: task.version, arrangements: rows }, confirmation ?? '', shanghaiDate(now));
  }

  // 原周期未变仅追加估算历史；变更关系先验证完整目标集合，事务内保留至少一条安排。
  for (const row of rows) {
    const old = previous.find((item) => item.periodId === row.periodId);
    if (!old) await repository.addArrangement(task, row.periodId, row.plannedDays, context.actor.id, now, row.workNote);
    else if (old.plannedDays !== row.plannedDays || (row.workNote !== undefined && (old.workNote ?? '') !== row.workNote)) await repository.estimate(task, row.periodId, row.plannedDays, context.actor.id, now, row.workNote);
  }
  for (const row of previous) if (!rows.some((item) => item.periodId === row.periodId)) await repository.removeArrangement(task.id, row.periodId, now);
}
