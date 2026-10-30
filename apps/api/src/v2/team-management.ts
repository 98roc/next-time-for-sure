import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { v2MemberImpactSchema, type V2MemberImpactInput, type V2TeamCommand } from '@ntfs/contracts';
import { requireVersion, type V2Context } from './context.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';

/** 当前团队配置由实际负责人或系统管理员维护，团队范围仍在事务中校验。 */
export function requireTeamLeader(context: V2Context): string {
  if (!context.teamId || !context.teamLeader) throw new ForbiddenException('只有团队负责人可以维护团队配置。');
  return context.teamId;
}

/** 移出只检查本项目未完成工作；保留已完成归属及私人任务，不触发隐式转交。 */
export async function memberImpact(manager: EntityManager, context: V2Context, input: V2MemberImpactInput) {
  const teamId = requireTeamLeader(context);
  const project = context.organization.projects.find((row) => row.id === input.projectId && row.teamId === teamId);
  if (!project) throw new ForbiddenException('项目不存在或无权维护。');
  requireVersion(project.version, input.version);
  const removedIds = project.members.filter((row) => !input.members.some((next) => next.accountId === row.accountId)).map((row) => row.accountId);
  const blockers: { kind: 'task' | 'role'; id: string; title: string; accountId: string | null }[] = [];
  for (const [role, label] of [['project_manager', '项目经理'], ['project_lead', '项目研发负责人']]) {
    if (!input.members.some((row) => row.roles.some((entry) => entry === role))) blockers.push({ kind: 'role', id: role ?? '', title: `至少保留一名${label}`, accountId: null });
  }
  const tasks = await new V2TaskRepository(manager).visible(context.actor.id, [project.id]);
  for (const task of tasks) if (task.kind === 'project' && task.status !== 'completed' && removedIds.includes(task.executorId)) blockers.push({ kind: 'task', id: task.id, title: task.title, accountId: task.executorId });
  return v2MemberImpactSchema.parse({ removedIds, blockers });
}

/** 完整成员及名称同事务保存；锁与任务分配共用，防止检查之后新增未完成任务。 */
export async function mutateTeam(manager: EntityManager, context: V2Context, command: V2TeamCommand): Promise<string[]> {
  const teamId = requireTeamLeader(context), planning = new V2PlanningRepository(manager);
  if (command.action === 'set_messages') {
    requireVersion((await planning.settings(teamId)).version, command.version);
    await planning.setMessages(teamId, command.messages); return [teamId];
  }
  const repository = new OrganizationRepository(manager);
  const previous = command.action === 'update_project' ? context.organization.projects.find((row) => row.id === command.projectId && row.teamId === teamId) : undefined;
  if (command.action === 'update_project') {
    const impact = await memberImpact(manager, context, command);
    if (impact.blockers.length) throw new ConflictException(`请先处理：${impact.blockers.map((row) => row.title).join('；')}`);
  } else if (!command.members.some((row) => row.roles.includes('project_manager')) || !command.members.some((row) => row.roles.includes('project_lead'))) throw new ConflictException('项目经理和项目研发负责人都至少保留一人。');

  // 已有停用成员可原样保留，但不能添加停用账号或为其新增角色。
  for (const member of command.members) {
    const account = context.organization.accounts.find((row) => row.id === member.accountId && row.teamId === teamId);
    const old = previous?.members.find((row) => row.accountId === member.accountId);
    if (!account || (account.disabled && (!old || member.roles.some((role) => !old.roles.includes(role))))) throw new ConflictException('新增成员及角色请选择本团队已启用账号。');
  }
  const id = command.action === 'create_project' ? await repository.createProject(teamId, command.name) : command.projectId;
  await manager.query('DELETE FROM project_members WHERE project_id=?', [id]);
  for (const member of command.members) await manager.query('INSERT INTO project_members(project_id,account_id,roles_json) VALUES (?,?,?)', [id, member.accountId, JSON.stringify(member.roles)]);
  await manager.query('UPDATE projects SET name=?,version=version+1 WHERE id=?', [command.name, id]);
  await manager.query("INSERT INTO v2_object_events(id,team_id,project_id,object_id,actor_id,action,payload_json,occurred_at) VALUES (?,?,?,?,?,'project.configured',?,UTC_TIMESTAMP(3))", [randomUUID(), teamId, id, id, context.actor.id, JSON.stringify({ before: previous ?? null, after: { name: command.name, members: command.members } })]);
  return [id];
}
