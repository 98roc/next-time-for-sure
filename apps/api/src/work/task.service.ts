import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TaskCommand, TaskImpact, WorkSnapshot } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { digest } from '../identity/password.js';
import { activeProject, loadWorkAccess, projectAccess } from './work-access.js';
import type { WorkAccess } from './work-access.js';
import { AssignmentRepository } from './assignment.repository.js';
import { WorkRepository } from './work.repository.js';
import { PersonalRepository } from './personal.repository.js';
import { canViewPersonal } from './personal-policy.js';
import { TaskRepository } from './task.repository.js';

type Task = WorkSnapshot['tasks'][number];
type Intent = TaskImpact['intent'];

/** 整体结束由任务责任身份确认，与任何成员本人完成分别表达。 */
@Injectable()
export class TaskService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 影响范围的个人标题仍按源记录权限裁剪，摘要覆盖全部实际关联版本。 */
  async impact(token: string, id: string, intent: Intent): Promise<TaskImpact> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      const task = await requireTask(manager, id);
      authorize(access, task, intent);
      if (stopped(task)) throw new ConflictException('任务已停止，请先刷新或重开。');
      return (await impact(manager, access, task, intent)).review;
    });
  }

  /** 确认后统一结束团队范围，但不自动完成个人、不传播时间到子任务。 */
  async execute(token: string, csrf: string, command: TaskCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const task = await requireTask(manager, command.taskId);
      if (['start_task', 'undo_start_task', 'reopen_task', 'task_progress'].includes(command.action)) activeProject(access, task.projectId);
      if (command.action === 'task_blocker') {
        projectAccess(access, task.projectId);
        const participating = (await new AssignmentRepository(manager).snapshot(task.projectId)).assignments.some((entry) => entry.taskId === task.id && entry.accountId === access.actor.id && !['exited', 'transferred'].includes(entry.status));
        if (task.ownerId !== access.actor.id && !participating) throw new ForbiddenException('只有主负责人或当前参与人可维护任务阻塞。');
      } else authorize(access, task, command.action);
      if (task.version !== command.version) throw new ConflictException('任务已变化，请刷新核对。');
      const repository = new TaskRepository(manager);
      const history = new WorkRepository(manager);

      if (command.action === 'task_times') {
        if (command.startedAt && command.endedAt && Date.parse(command.startedAt) > Date.parse(command.endedAt)) throw new BadRequestException('结束时间不能早于开始时间。');
        await repository.times(task.id, command.startedAt, command.endedAt);
      } else if (command.action === 'task_blocker') {
        await validateWaiting(manager, task, command.waitingTaskId);
        await repository.blocker(task.id, command.blockedReason, command.waitingFor, command.waitingTaskId);
      } else if (command.action === 'reorder_task') {
        const column = (await history.snapshot(task.projectId)).tasks.filter((entry) => entry.status === task.status);
        if (column.length !== command.order.length || column.some((entry, index) => entry.id !== command.order[index]?.id || entry.version !== command.order[index]?.version)) throw new ConflictException('列表顺序或内容已变化，请刷新后移动。');
        if (command.beforeId === task.id || (command.beforeId && !column.some((entry) => entry.id === command.beforeId))) throw new BadRequestException('目标必须是同一状态列内的其他任务。');
        const ordered = column.filter((entry) => entry.id !== task.id);
        ordered.splice(command.beforeId ? ordered.findIndex((entry) => entry.id === command.beforeId) : ordered.length, 0, task);
        for (const [index, entry] of ordered.entries()) if (entry.position !== index) await repository.position(entry.id, index);
      } else if (command.action === 'change_owner') {
        const project = projectAccess(access, task.projectId);
        const owner = access.organization.accounts.find((entry) => entry.id === command.ownerId && entry.teamId === project.teamId && !entry.disabled);
        if (!owner || !project.members.some((member) => member.accountId === owner.id && member.roles.some((role) => role === 'developer' || role === 'project_lead'))) throw new BadRequestException('主负责人必须是当前项目可用研发成员。');
        await repository.owner(task.id, command.ownerId);
      } else if (command.action === 'undo_start_task') {
        if (task.status !== 'in_progress') throw new ConflictException('只有进行中的任务可以撤销开始。');
        await ensureParentActive(manager, task);
        if (task.progress > 0 || task.endedAt || !(await repository.hasUndoableStart(task.id)) || await repository.hasExecutionFacts(task.id)) {
          throw new ConflictException('已有执行进展、开始时间修正或关联工作已执行，不能撤销开始。现有记录保持不变。');
        }
        await repository.undoStart(task.id);
      } else if (command.action === 'reopen_task') {
        if (!stopped(task)) throw new ConflictException('只有已完成或取消的任务可重开。');
        await ensureParentActive(manager, task);
        await repository.transition(task.id, command.action);
      } else {
        if (stopped(task)) throw new ConflictException('团队任务已停止，请先按权限重开。');
        await ensureParentActive(manager, task);
        if (command.action === 'task_progress') await repository.progress(task.id, command.progress);
        else if (command.action === 'start_task') {
          if (task.status === 'in_progress') throw new ConflictException('任务已在进行中。');
          await repository.transition(task.id, command.action);
        } else {
          const current = await impact(manager, access, task, command.action);
          if (current.review.confirmation !== command.confirmation) throw new ConflictException('关联工作已变化，请重新获取影响范围并确认。');
          await repository.transition(task.id, command.action);

          // 只结束尚未停止的团队子任务，个人状态与各自时间完全不动。
          for (const child of current.children.filter((entry) => !stopped(entry))) {
            await repository.transition(child.id, command.action, true);
            await history.event(task.projectId, child.id, access.actor.id, 'task.ended_by_parent', { parentId: task.id, before: child, after: await requireTask(manager, child.id) });
          }
        }
      }
      // 团队事件只记录团队对象，不能携带影响预览中的个人源内容。
      await history.event(task.projectId, task.id, access.actor.id, `task.${command.action}`, { ...command, before: task, after: await requireTask(manager, task.id) });
      await new IdentityRepository(manager).audit(access.actor.id, `task.${command.action}`, task.id);
      return { objectId: task.id };
    });
  }
}

/** 固定责任规则不会因超管或仅组长身份扩大到任务整体操作。 */
function authorize(access: WorkAccess, task: Task, action: TaskCommand['action']) {
  const project = projectAccess(access, task.projectId);
  const manager = access.organization.teams.some((team) => team.id === project.teamId && team.leaderId === access.actor.id) || project.members.some((member) => member.accountId === access.actor.id && member.roles.includes('project_lead'));
  const allowed = action === 'change_owner' ? manager : ['reopen_task', 'cancel_task'].includes(action) ? manager || task.ownerId === access.actor.id : task.ownerId === access.actor.id;
  if (!allowed) throw new ForbiddenException('没有该任务的整体操作权限。');
}
function stopped(task: Task) { return task.status === 'completed' || task.status === 'cancelled'; }
/** 依赖仅表达同项目其他任务，不允许自依赖或跨项目泄露。 */
export async function validateWaiting(manager: EntityManager, task: Task, waitingId: string | null): Promise<void> {
  if (!waitingId) return;
  const waiting = await new AssignmentRepository(manager).task(waitingId);
  if (!waiting || waiting.id === task.id || waiting.projectId !== task.projectId) throw new BadRequestException('等待任务必须是同项目的其他任务。');
}
async function requireTask(manager: EntityManager, id: string) { const task = await new AssignmentRepository(manager).task(id); if (!task) throw new NotFoundException('任务不存在。'); return task; }
/** 子任务不得绕过已结束父任务恢复执行。 */
export async function ensureParentActive(manager: EntityManager, task: Task): Promise<void> {
  if (task.parentId && stopped(await requireTask(manager, task.parentId))) throw new ConflictException('父任务已停止，请先重开父任务。');
}
/** 内部摘要覆盖全部关联版本，返回明细则按当前查看范围裁剪。 */
async function impact(manager: EntityManager, access: WorkAccess, task: Task, intent: Intent) {
  const tasks = (await new WorkRepository(manager).snapshot(task.projectId)).tasks;
  const children = tasks.filter((entry) => entry.parentId === task.id).sort((a, b) => a.id.localeCompare(b.id));
  const scope = new Set([task.id, ...children.map((entry) => entry.id)]);
  const assignments = (await new AssignmentRepository(manager).snapshot(task.projectId)).assignments.filter((entry) => scope.has(entry.taskId)).sort((a, b) => a.id.localeCompare(b.id));
  const assignmentIds = new Set(assignments.map((entry) => entry.id));
  const personal = (await new PersonalRepository(manager).candidates(access.actor.id, access.actor.teamId)).filter((item) => item.kind === 'work' && item.assignmentId && assignmentIds.has(item.assignmentId)).sort((a, b) => a.id.localeCompare(b.id));
  const unfinished = personal.filter((entry) => entry.status !== 'completed');
  const visible = unfinished.filter((entry) => canViewPersonal(access, entry));
  const review: TaskImpact = {
    taskId: task.id, version: task.version, intent,
    confirmation: digest(JSON.stringify({ intent, task, children, assignments, personal: personal.map((entry) => ({ id: entry.id, version: entry.version })) })),
    children: children.filter((entry) => !stopped(entry)).map(({ id, title }) => ({ id, title })),
    assignments: assignments.filter((entry) => ['not_started', 'in_progress'].includes(entry.status)).map(({ id, accountId, content }) => ({ id, accountId, content })),
    personal: visible.map(({ id, title }) => ({ id, title })), hiddenPersonalCount: unfinished.length - visible.length,
  };
  return { review, children };
}
