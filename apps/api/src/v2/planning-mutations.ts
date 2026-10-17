import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2PlanningCommand, V2ReportCommand } from '@ntfs/contracts';
import { checkRule, requireProject, requireVersion, type V2Context } from './context.js';
import { canManageProject } from './permissions.js';
import { V2PlanningRepository } from './planning.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { shiftDate } from './calendar.js';
import { requireConfirmation } from './impact.js';
import { confirmReport, editReport, reorderScoped } from './shared-report.js';
import { buildWeeklyState } from './weekly-state.js';
import { summarizePeriod } from './history.js';

/** 团队负责人管日期与跨项目排序，项目负责人只能管理本项目区间内顺序。 */
export function authorizePlanning(context: V2Context, command: V2PlanningCommand): void {
  if (!context.teamId) throw new ForbiddenException('请先加入团队。');
  if (command.action === 'reorder_tasks') {
    if (!canManageProject(context.actor, requireProject(context, command.projectId))) throw new ForbiddenException('没有本项目排序权限。');
  } else if (command.action !== 'extend_periods' && !context.teamLeader) throw new ForbiddenException('仅团队负责人可以维护日期和跨项目排序。');
}

/** 日期扩展仅在范围边缘补自然周；任意边界调整必须预览并验证历史锁定。 */
export async function mutatePlanning(manager: EntityManager, context: V2Context, command: V2PlanningCommand, today: string): Promise<string[]> {
  if (!context.teamId) throw new ForbiddenException('请先加入团队。');
  const repository = new V2PlanningRepository(manager), teamId = context.teamId;
  if (command.action === 'extend_periods' || command.action === 'change_periods') {
    const periods = await repository.periods(teamId); requireVersion((await repository.settings(teamId)).version, command.version);
    if (command.action === 'extend_periods') {
      const edge = command.direction === 'before' ? periods[0] : periods.at(-1);
      if (!edge) throw new ConflictException('区间目录尚未初始化。');
      const startOn = command.direction === 'before' ? shiftDate(edge.startOn, -7) : shiftDate(edge.endOn, 1);
      const id = randomUUID(); await repository.insertPeriod({ id, teamId, startOn, endOn: shiftDate(startOn, 6), version: 0 }); await repository.bump(teamId); return [id];
    }
    await requireConfirmation(manager, context, { action: command.action, version: command.version, periods: command.periods }, command.confirmation, today);
    const proposed = periods.map((period) => { const change = command.periods.find((row) => row.periodId === period.id); return change ? { ...period, startOn: change.startOn, endOn: change.endOn } : period; });
    await repository.updatePeriods(periods, proposed, teamId, context.actor.id); return command.periods.map((row) => row.periodId);
  }
  let scope: string, ids: string[], allowed: string[], requested: string[];
  if (command.action === 'reorder_projects') { scope = 'projects'; ids = context.organization.projects.filter((project) => project.teamId === teamId).map((project) => project.id); allowed = ids; requested = command.projectIds; }
  else {
    const period = (await repository.periods(teamId)).find((row) => row.id === command.periodId);
    if (!period) throw new ConflictException('日期区间不存在。');
    const tasks = new V2TaskRepository(manager), projectTasks = await tasks.visible(context.actor.id, [command.projectId]);
    const rows = await tasks.arrangements(projectTasks.filter((task) => task.kind === 'project').map((task) => task.id));
    const historyIds = await tasks.projectTaskIds([command.projectId]);
    const summary = summarizePeriod(period, await tasks.history(historyIds), await repository.arrangementHistory(historyIds), new Date().toISOString());
    const planIds = rows.filter((row) => row.periodId === command.periodId).map((row) => row.taskId);
    ids = [...new Set([...summary.map((row) => row.taskId), ...planIds])];
    allowed = command.view === 'summary' ? summary.filter((row) => !command.executorId || row.executorId === command.executorId).map((row) => row.taskId) : planIds.filter((id) => !command.executorId || projectTasks.find((task) => task.id === id)?.executorId === command.executorId);
    requested = command.taskIds; scope = `tasks:${command.projectId}:${command.periodId}`;
  }
  const current = await repository.order(teamId, scope, ids);
  const next = checkRule(() => reorderScoped(current.ids, allowed, requested, current.version, command.version));
  await repository.saveOrder(teamId, scope, next); return [teamId];
}

/** 手工稿写入前读当前来源；旧来源保存保留未同步状态，核对/重生必须精确匹配。 */
export async function mutateReport(manager: EntityManager, context: V2Context, command: V2ReportCommand): Promise<string[]> {
  if (!context.teamLeader || !context.teamId) throw new ForbiddenException('只有团队负责人可以维护共享文字稿。');
  const repository = new V2PlanningRepository(manager), { source, state } = await buildWeeklyState(manager, context, command.summaryPeriodId, command.planPeriodId);
  const saved = await repository.report(context.teamId, command.summaryPeriodId, command.planPeriodId);
  const text = command.action === 'save' ? checkRule(() => editReport(saved, command.version, command.body, command.sourceHash)) : checkRule(() => confirmReport(saved ?? state.text, command.version, command.sourceHash, source, command.action === 'regenerate'));
  await repository.saveReport(context.teamId, command.summaryPeriodId, command.planPeriodId, context.actor.id, text); return [context.teamId];
}
