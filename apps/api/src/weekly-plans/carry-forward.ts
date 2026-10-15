import type { EntityManager } from 'typeorm';
import type { WorkAccess } from '../work/work-access.js';
import { hasPermission } from '../organization/policy.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { WeeklyPlansRepository } from './weekly-plans.repository.js';
import { ReportingRepository } from './reporting.repository.js';
import { planningCandidates } from './planning-candidates.js';

/** 上海日历的本周与下周允许自动延续；历史周和远期周只按明确操作安排。 */
export function automaticCarryWeek(week: string, now = new Date()): boolean {
  const date = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const current = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return week === current || week === date.toISOString().slice(0, 10);
}

/** 幂等补入仍可执行的往期工作；组织锁由调用方持有，已发布目标周保持不变。 */
export async function carryForward(manager: EntityManager, access: WorkAccess, team: string, week: string) {
  const reporting = new ReportingRepository(manager);
  if ((await reporting.publications(team, week, 'plan')).length) return;
  const repository = new WeeklyPlansRepository(manager);
  const candidates = await planningCandidates(manager, access, team);
  const draft = await repository.draft(team, week);
  const arrangements = draft ? await repository.arrangements(draft.id) : [];
  const pending = draft ? await repository.pending(draft.id) : [];
  let draftId = draft?.id;
  const added: { kind: string; objectId: string; sourceWeek: string }[] = [];

  // 只延续人员尚未完成的分工；不会因为整个团队任务未完成而带回已完成分工。
  for (const source of await repository.carrySources(team, week, 'assignment')) {
    if (!candidates.some((entry) => entry.assignmentId === source.objectId) || arrangements.some((entry) => entry.assignmentId === source.objectId)) continue;
    draftId ??= await repository.ensure(team, week);
    await repository.save(draftId, source.objectId, { goal: '', plannedDays: null, expectedProgress: null }, undefined, source.sourceWeek);
    added.push({ ...source, kind: 'assignment' });
  }

  // 待分配事项由团队负责人范围维护；与已落实的人员安排不重复延续。
  if (hasPermission(access.actor, access.organization, 'work.assign', { teamId: team })) {
    const work = new AssignmentRepository(manager);
    const scheduledTasks = new Set<string>();
    if (draftId) for (const entry of await repository.arrangements(draftId)) {
      const assignment = await work.assignment(entry.assignmentId);
      if (assignment) scheduledTasks.add(assignment.taskId);
    }
    for (const source of await repository.carrySources(team, week, 'task')) {
      if (pending.some((entry) => entry.taskId === source.objectId) || scheduledTasks.has(source.objectId)) continue;
      const task = await work.task(source.objectId);
      if (!task || ['completed', 'cancelled'].includes(task.status) || await work.hasChildren(task.id)) continue;
      if (!access.organization.projects.some((entry) => entry.id === task.projectId && entry.teamId === team && !entry.archived)) continue;
      draftId ??= await repository.ensure(team, week);
      await repository.addPending(draftId, task.id, source.sourceWeek);
      added.push({ ...source, kind: 'task' });
    }
  }
  if (added.length) await reporting.event(team, access.actor.id, 'auto_carry_forward', { week, added });
}
