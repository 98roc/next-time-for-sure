import { periodOrderSource } from './period-order.js';
import { projectItemIds } from './project-orders.js';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2PlanningCommand, V2ReportCommand } from '@ntfs/contracts';
import { checkRule, requireProject, requireVersion, type V2Context } from './context.js';
import { canManageProject } from './permissions.js';
import { V2PlanningRepository } from './planning.repository.js';
import { shiftDate } from './calendar.js';
import { requireConfirmation } from './impact.js';
import { confirmReport, editReport, reorderScoped } from './shared-report.js';
import { buildWeeklyState } from './weekly-state.js';

/** 团队负责人管日期与跨项目排序，项目负责人只能管理本项目区间内顺序。 */
export function authorizePlanning(context: V2Context, command: V2PlanningCommand): void {
  if (!context.teamId) throw new ForbiddenException('请先加入团队。');
  if (command.action === 'reorder_tasks' || command.action === 'reorder_project_items') {
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
  let newestIds: string[] | undefined;
  let scope: string, ids: string[], allowed: string[], requested: string[];
  if (command.action === 'reorder_projects') {
    if (command.page === 'projects') scope = 'project-page:projects';
    else {
      const periods = await repository.periods(teamId);
      const period = command.periodId ? periods.find((row) => row.id === command.periodId) : periods.find((row) => row.startOn <= today && row.endOn >= today);
      if (!period) throw new ConflictException('日期区间不存在。');
      scope = `projects:${period.id}`;
    }
    ids = context.organization.projects.filter((project) => project.teamId === teamId).map((project) => project.id);
    allowed = ids; requested = command.projectIds;
  } else if (command.action === 'reorder_project_items') {
    scope = `project-page:${command.target}:${command.projectId}`;
    const source = await projectItemIds(manager, command.projectId, command.target);
    ids = source.ids; newestIds = source.newestIds;
    // 项目页有状态/日期筛选：只替换明确提交的子集，隐藏任务仍留在原位置。
    allowed = command.ids; requested = command.ids;
  } else {
    const period = (await repository.periods(teamId)).find((row) => row.id === command.periodId);
    if (!period) throw new ConflictException('日期区间不存在。');
    const source = await periodOrderSource(manager, command.projectId, period);
    ids = source.ids; newestIds = source.newestIds;
    allowed = command.view === 'summary' ? source.summary.filter((row) => !command.executorId || row.executorId === command.executorId).map((row) => row.taskId) : source.plan.filter((row) => !command.executorId || row.executorId === command.executorId).map((row) => row.id);
    requested = command.taskIds; scope = `tasks:${command.projectId}:${command.periodId}`;
  }
  const current = await repository.order(teamId, scope, ids, newestIds);
  requireVersion(current.version, command.version);
  if (command.reset) {
    // 恢复默认作用于整个项目/区间；前端入口明确显示此范围，不只重排筛选结果。
    await repository.saveOrder(teamId, scope, [], false);
  } else {
    const next = checkRule(() => reorderScoped(current.ids, allowed, requested, current.version, command.version));
    await repository.saveOrder(teamId, scope, next);
  }
  return [teamId];
}

/** 手工稿写入前读当前来源；旧来源保存保留未同步状态，核对/重生必须精确匹配。 */
export async function mutateReport(manager: EntityManager, context: V2Context, command: V2ReportCommand): Promise<string[]> {
  if (!context.teamLeader || !context.teamId) throw new ForbiddenException('只有团队负责人可以维护共享文字稿。');
  const repository = new V2PlanningRepository(manager), { source, state } = await buildWeeklyState(manager, context, command.summaryPeriodId, command.planPeriodId);
  const saved = await repository.report(context.teamId, command.summaryPeriodId, command.planPeriodId);
  const text = command.action === 'save' ? checkRule(() => editReport(saved, command.version, command.body, command.sourceHash)) : checkRule(() => confirmReport(saved ?? state.text, command.version, command.sourceHash, source, command.action === 'regenerate'));
  await repository.saveReport(context.teamId, command.summaryPeriodId, command.planPeriodId, context.actor.id, text); return [context.teamId];
}
