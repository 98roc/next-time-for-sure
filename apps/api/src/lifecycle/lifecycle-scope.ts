import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { LifecycleIntent } from '@ntfs/contracts';
import type { WorkAccess } from '../work/work-access.js';
import { projectAccess } from '../work/work-access.js';
import { WorkRepository } from '../work/work.repository.js';
import { PersonalRepository } from '../work/personal.repository.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { canViewPersonal } from '../work/personal-policy.js';
import { LifecycleRepository } from './lifecycle.repository.js';
import { digest } from '../identity/password.js';

/** 预览与执行共用完整快照；文字预览不泄露无权访问的个人内容。 */
export async function lifecycleScope(manager: EntityManager, access: WorkAccess, intent: LifecycleIntent) {
  const work = new WorkRepository(manager); const personal = new PersonalRepository(manager); const assignments = new AssignmentRepository(manager);
  const repository = new LifecycleRepository(manager); const blockers: string[] = []; const impacts: string[] = [];
  let team = access.actor.teamId; let title: string; let fingerprint: unknown; let projectId: string | null = null;
  const task = ['delete_task', 'transfer_task'].includes(intent.action) ? await assignments.task(intent.objectId) : undefined;
  const item = ['delete_personal', 'transfer_personal'].includes(intent.action) ? await personal.item(intent.objectId) : undefined;
  let taskIds: string[] = []; let joinIds: string[] = [];
  const teamLeader = (id: string) => access.actor.teamId === id && access.organization.teams.some((entry) => entry.id === id && entry.leaderId === access.actor.id);
  if (intent.action === 'remove_project_member') {
    const project = projectAccess(access, intent.projectId); team = project.teamId; projectId = project.id;
    if (!teamLeader(team)) throw new ForbiddenException('仅团队负责人可移出项目成员。');
    if (!project.members.some((member) => member.accountId === intent.objectId)) throw new NotFoundException('项目成员不存在。');
    const remaining = project.members.filter((member) => member.accountId !== intent.objectId && access.organization.accounts.some((account) => account.id === member.accountId && account.teamId === team && !account.disabled));
    for (const role of ['project_manager', 'project_lead']) if (!remaining.some((member) => member.roles.some((value) => value === role))) blockers.push('请先设置在队且启用的项目经理和研发负责人。');
    title = `从${project.name}移出${access.organization.accounts.find((account) => account.id === intent.objectId)?.displayName ?? intent.objectId}`; impacts.push('移除该项目角色；历史、分工和个人执行事实保留，其他小组或团队角色带来的权限按现有规则计算。');
    fingerprint = { project, accounts: access.organization.accounts.filter((account) => project.members.some((member) => member.accountId === account.id)) };
  } else if (intent.action === 'remove_member') {
    const account = access.organization.accounts.find((entry) => entry.id === intent.objectId);
    if (!account?.teamId || !teamLeader(account.teamId)) throw new ForbiddenException('仅当前团队负责人可移出本团队成员。');
    team = account.teamId; title = `移出成员：${account.displayName}`;
    if (access.organization.teams.some((entry) => entry.leaderId === account.id && entry.id === team)) blockers.push('请先由超管更换团队负责人。');
    const tasks = []; const responsibilities = [];
    for (const project of access.organization.projects.filter((entry) => entry.teamId === team)) {
      const snapshot = await work.snapshot(project.id); const state = await assignments.snapshot(project.id);
      tasks.push(...snapshot.tasks.filter((entry) => entry.ownerId === account.id && !stopped(entry.status)));
      responsibilities.push(...state.assignments.filter((entry) => entry.accountId === account.id && !stopped(entry.status) && !['exited', 'transferred'].includes(entry.status)));
    }
    impacts.push(`未结束主责任务 ${tasks.length} 项、原人员未完成分工 ${responsibilities.length} 项，保留供手动交接。`, '移出立即失去原团队工作访问；私人事项保留，原工作及历史不随账号转移。');
    fingerprint = { account, tasks, responsibilities, groups: access.organization.groups.filter((entry) => entry.leaderId === account.id), projects: access.organization.projects.filter((entry) => entry.members.some((member) => member.accountId === account.id)) };
  } else if (intent.action === 'archive_project' || intent.action === 'restore_project') {
    const project = projectAccess(access, intent.objectId); team = project.teamId; projectId = project.id;
    if (!teamLeader(team) && !project.members.some((entry) => entry.accountId === access.actor.id && entry.roles.includes('project_lead'))) throw new ForbiddenException('仅团队负责人或项目研发负责人可归档恢复。');
    const tasks = (await work.snapshot(project.id)).tasks; const items = (await personal.candidates(access.actor.id, team)).filter((entry) => entry.kind === 'work' && entry.projectId === project.id);
    title = `${intent.action === 'archive_project' ? '归档' : '恢复'}项目：${project.name}`;
    if (intent.action === 'archive_project') {
      if (project.archived) blockers.push('项目已经归档。');
      blockers.push(...tasks.filter((entry) => !stopped(entry.status)).map((entry) => `未结束团队任务：${entry.title}`));
      blockers.push(...items.filter((entry) => !entry.assignmentId && entry.status !== 'completed').map((entry) => `未完成独立工作：${canViewPersonal(access, entry) ? entry.title : '受权限保护的个人工作'}`));
    } else if (!project.archived) blockers.push('项目尚未归档。');
    impacts.push('保留历史及已发布周报；归档期间禁止新增工作及进入新周计划。'); fingerprint = { project, tasks, items: items.map(({ id, version }) => ({ id, version })) };
  } else if (task) {
    const project = projectAccess(access, task.projectId); team = project.teamId; projectId = project.id;
    const manage = teamLeader(team) || project.members.some((entry) => entry.accountId === access.actor.id && entry.roles.includes('project_lead'));
    if (intent.action === 'transfer_task' ? !teamLeader(team) : !manage && task.ownerId !== access.actor.id) throw new ForbiddenException('没有该生命周期操作权限。');
    const children = (await work.snapshot(project.id)).tasks.filter((entry) => entry.parentId === task.id); taskIds = [task.id, ...children.map((entry) => entry.id)];
    const state = await assignments.snapshot(project.id); const involved = state.assignments.filter((entry) => taskIds.includes(entry.taskId));
    const items = (await personal.candidates(access.actor.id, team)).filter((entry) => entry.assignmentId && involved.some((assignment) => assignment.id === entry.assignmentId));
    title = `${intent.action === 'delete_task' ? '删除' : '转移'}任务：${task.title}`;
    if (intent.action === 'delete_task') {
      if (children.length) blockers.push('请先处理子任务，不能连带删除。');
      if (items.length) blockers.push('请先处理关联个人工作，不能连带删除他人事项。');
      if (task.startedAt || task.endedAt || task.progress || task.status !== 'not_started' || involved.some((entry) => entry.startedAt || entry.endedAt || entry.status !== 'not_started') || state.progress.some((entry) => involved.some((assignment) => assignment.id === entry.assignmentId))) blockers.push('已有执行记录，请取消或归档。');
      if (await repository.published(task.id)) blockers.push('任务已进入正式计划或周报，禁止删除。');
      if (await repository.executed(task.id)) blockers.push('历史中已有执行事实，禁止删除。');
      impacts.push('永久删除任务及未执行分工、草稿安排；保留操作历史，不提供恢复。');
    } else {
      if (task.parentId) blockers.push('子任务请随父任务整体转移，避免跨项目父子关系。');
      joinIds = [...new Set([task.ownerId, ...children.map((entry) => entry.ownerId), ...involved.filter((entry) => !['exited', 'transferred'].includes(entry.status)).map((entry) => entry.accountId)])];
      impacts.push(`连同 ${children.length} 个子任务及 ${items.length} 条关联个人工作转移；按目标项目权限开放查看。`, '不改变个人内容、状态和时间；旧发布快照保留，历史参与人不自动加入目标项目。');
    }
    fingerprint = { task, children, involved, progress: state.progress.filter((entry) => involved.some((assignment) => assignment.id === entry.assignmentId)), items: items.map(({ id, version }) => ({ id, version })) };
  } else if (item) {
    if (intent.action === 'transfer_personal' && (!team || !teamLeader(team))) throw new ForbiddenException('仅团队负责人可跨项目转移独立工作。');
    if (!canViewPersonal(access, item) || item.ownerId !== access.actor.id && (intent.action === 'delete_personal' || !team || !teamLeader(team))) throw new ForbiddenException('无权处理该个人事项。');
    if (intent.action === 'delete_personal' && item.ownerId !== access.actor.id) throw new ForbiddenException('仅本人可删除个人事项。');
    projectId = item.projectId; title = `${intent.action === 'delete_personal' ? '删除' : '转移'}个人事项：${item.title}`;
    if (intent.action === 'transfer_personal' && (item.kind !== 'work' || item.assignmentId)) blockers.push('只能单独转移独立工作；关联工作随团队任务转移。');
    impacts.push(intent.action === 'delete_personal' ? '永久删除事项及进展，分工状态不自动完成，旧发布副本保留。' : '目标项目成员可按权限查看工作，个人状态及时间不变。');
    joinIds = [item.ownerId]; fingerprint = { item, progress: await personal.progressFor([item.id]) };
  } else throw new NotFoundException('对象不存在。');
  if ('targetProjectId' in intent) {
    const target = access.organization.projects.find((entry) => entry.id === intent.targetProjectId && entry.teamId === team);
    if (!target || target.archived || target.id === projectId) blockers.push('目标必须是本团队另一个未归档项目。');
    fingerprint = { source: fingerprint, target };
    joinIds = joinIds.filter((id) => access.organization.accounts.some((entry) => entry.id === id && entry.teamId === team && !entry.disabled));
    fingerprint = { scope: fingerprint, participants: access.organization.accounts.filter((entry) => joinIds.includes(entry.id)) };
  }
  return { team, projectId, taskIds, joinIds, task, item, review: { title, impacts, blockers, confirmation: digest(JSON.stringify({ intent, fingerprint, blockers })) } };
}
/** 停止执行的个人整理不阻止项目归档。 */
function stopped(status: string) { return ['completed', 'cancelled'].includes(status); }
