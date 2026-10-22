import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2Impact, V2ImpactIntent } from '@ntfs/contracts';
import { requireVersion, type V2Context } from './context.js';
import { authorizeProjectCommand, authorizeTaskCommand, requireTask } from './authorization.js';
import { V2TaskRepository } from './task.repository.js';
import { V2ProjectRepository } from './project.repository.js';
import { V2PersonalRepository } from './personal.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { hashValue } from './repository-utils.js';
import { rearrangeTask, validateMilestoneCompletion } from './task-rules.js';
import { removeCategory } from './personal-view.js';
import { validatePeriodChanges } from './calendar.js';

/** 预览绑定当前版本和所有受影响对象；再次执行时重新计算，不能接受旧预览。 */
export async function previewImpact(manager: EntityManager, context: V2Context, intent: V2ImpactIntent, today: string): Promise<V2Impact> {
  const tasks = new V2TaskRepository(manager), projects = new V2ProjectRepository(manager), personal = new V2PersonalRepository(manager), planning = new V2PlanningRepository(manager);
  const details: string[] = [], blockers: string[] = [];
  let title: string, facts: unknown;
  const inspect = (work: () => void) => { try { work(); } catch (error) { blockers.push(error instanceof Error ? error.message : '当前状态不允许操作'); } };
  const operationId = context.actor.id;
  if ('taskId' in intent) {
    const task = requireTask(context, await tasks.get(intent.taskId));
    requireVersion(task.version, intent.version);
    if (intent.action === 'unlink_milestone') await authorizeProjectCommand(manager, context, { ...intent, operationId, confirmation: '0'.repeat(64) });
    else if (intent.action === 'delete_task') authorizeTaskCommand(context, { ...intent, action: 'delete', operationId, confirmation: '0'.repeat(64) }, task);
    else if (intent.action === 'save_arrangements') authorizeTaskCommand(context, { action: 'add_arrangement', operationId, taskId: task.id, version: task.version, periodId: intent.arrangements[0]?.periodId ?? task.id, plannedDays: null }, task);
    else if (intent.action === 'change_arrangement') authorizeTaskCommand(context, { ...intent, operationId, confirmation: '0'.repeat(64), plannedDays: null }, task);
    else authorizeTaskCommand(context, { ...intent, operationId, confirmation: '0'.repeat(64) }, task);
    const rows = await tasks.arrangements([task.id]);
    const periods = task.teamId ? await planning.periods(task.teamId) : [];
    title = task.title; facts = { task, rows, periods };
    if (task.deletedAt) blockers.push('任务已删除');
    if (intent.action === 'delete_task') details.push('删除整条任务及所有当前区间安排；历史事件和人工文字保留。', ...rows.map((row) => { const period = periods.find((entry) => entry.id === row.periodId); return period ? `${period.startOn}—${period.endOn}` : row.periodId; }));
    else if (intent.action === 'unlink_milestone') { details.push('只解除里程碑关联，保留任务、执行人、日期区间和状态。'); if (!task.milestoneId) blockers.push('当前任务没有关联里程碑'); }
    else if (intent.action === 'save_arrangements') {
      if (intent.arrangements.some((row) => !periods.some((period) => period.id === row.periodId))) blockers.push('目标区间不存在');
      const label = (id: string) => { const period = periods.find((row) => row.id === id); return period ? `${period.startOn}—${period.endOn}` : id; };
      details.push(...rows.filter((row) => !intent.arrangements.some((item) => item.periodId === row.periodId)).map((row) => `取消安排：${label(row.periodId)}`));
      details.push(...intent.arrangements.filter((row) => !rows.some((item) => item.periodId === row.periodId)).map((row) => `新增安排：${label(row.periodId)}`));
      details.push('保留任务及安排历史；预计投入按各周期独立保存。');
    } else {
      const target = intent.action === 'change_arrangement' ? intent.targetPeriodId : null;
      inspect(() => { rearrangeTask(rows.map((row) => row.periodId), intent.periodId, target); });
      if (target && !periods.some((row) => row.id === target)) blockers.push('目标区间不存在');
      const original = periods.find((row) => row.id === intent.periodId), destination = periods.find((row) => row.id === target);
      details.push(original ? `原安排：${original.startOn}—${original.endOn}` : '原安排已变化');
      details.push(destination ? `目标安排：${destination.startOn}—${destination.endOn}` : '仅取消此区间安排，保留任务及其他安排。');
    }
  } else if ('milestoneId' in intent) {
    await authorizeProjectCommand(manager, context, { ...intent, operationId, confirmation: '0'.repeat(64) });
    const milestone = await projects.milestone(intent.milestoneId);
    if (!milestone) throw new ConflictException('里程碑不存在。');
    requireVersion(milestone.version, intent.version);
    const related = (await tasks.visible(context.actor.id, [milestone.projectId])).filter((task) => task.milestoneId === milestone.id);
    title = milestone.title; facts = { milestone, tasks: related };
    if (intent.action === 'complete_milestone') { inspect(() => validateMilestoneCompletion(milestone, related)); if (milestone.status !== 'open') blockers.push('里程碑已经完成'); details.push(`关联任务 ${related.length} 条；请确认阶段目标实际已达成。`); }
    else { if (milestone.status !== 'completed') blockers.push('里程碑尚未完成'); details.push('重开目标并保留原完成历史，不修改关联任务状态。'); }
  } else if (intent.action === 'delete_backlog') {
    await authorizeProjectCommand(manager, context, { ...intent, operationId, confirmation: '0'.repeat(64) });
    const row = await projects.backlogItem(intent.backlogId);
    if (!row) throw new ConflictException('待建任务不存在。');
    requireVersion(row.version, intent.version); title = row.title; facts = row;
    if (row.convertedTaskId) blockers.push('待建任务已转换，请维护正式任务');
    if (row.deletedAt) blockers.push('待建任务已删除');
    details.push('从待建任务列表移出，保留必要操作历史。');
  } else if (intent.action === 'delete_category') {
    requireVersion(await personal.version(context.actor.id), intent.version);
    const categories = await personal.categories(context.actor.id), placements = await personal.placements(context.actor.id);
    inspect(() => { removeCategory(categories, intent.categoryId, intent.receiverId); });
    title = categories.find((row) => row.id === intent.categoryId)?.name ?? '分类'; facts = { categories, placements };
    details.push(`保留并移动 ${placements.filter((row) => row.categoryId === intent.categoryId).length} 条任务到所选同状态分类；默认分类职责随之移交。`);
  } else {
    if (!context.teamId || !context.teamLeader) throw new ForbiddenException('只有团队负责人可以调整区间。');
    const settings = await planning.settings(context.teamId), periods = await planning.periods(context.teamId);
    requireVersion(settings.version, intent.version);
    const proposed = periods.map((period) => { const change = intent.periods.find((row) => row.periodId === period.id); return change ? { ...period, startOn: change.startOn, endOn: change.endOn, version: change.version } : period; });
    if (new Set(intent.periods.map((row) => row.periodId)).size !== intent.periods.length || intent.periods.some((row) => !periods.some((period) => period.id === row.periodId))) blockers.push('区间列表包含重复或不存在的记录');
    inspect(() => validatePeriodChanges(periods, proposed, today));
    const taskIds = await tasks.projectTaskIds(context.projects.map((project) => project.id));
    const arrangements = await tasks.arrangements(taskIds), texts = await planning.reportVersions(context.teamId);
    title = '调整团队日期区间'; facts = { settings, periods, arrangements, texts };
    for (const change of intent.periods) { const old = periods.find((row) => row.id === change.periodId); if (old) details.push(`${old.startOn}—${old.endOn} → ${change.startOn}—${change.endOn}；${arrangements.filter((row) => row.periodId === old.id).length} 条安排`); }
    details.push('相关总结按新边界重新计算，手工文字保留并显示未同步提示。');
  }
  return { title, details, blockers, confirmation: hashValue({ actorId: context.actor.id, intent, facts }) };
}

/** 确认只适用于当前影响，数据变化或阻止原因出现时不得继续提交。 */
export async function requireConfirmation(manager: EntityManager, context: V2Context, intent: V2ImpactIntent, confirmation: string, today: string): Promise<void> {
  const preview = await previewImpact(manager, context, intent, today);
  if (preview.blockers.length) throw new ConflictException(preview.blockers.join('；'));
  if (preview.confirmation !== confirmation) throw new ConflictException('操作影响已变化，请重新预览并确认。');
}
