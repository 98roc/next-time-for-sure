import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { IdentityService } from '../identity/identity.service.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import { canViewProject, type V2Actor, type V2ProjectAccess } from './permissions.js';

export type V2Context = { operationId?: string; actor: V2Actor; organization: OrganizationSnapshot; projects: V2ProjectAccess[]; teamId: string | null; teamLeader: boolean };

/** 组织锁先于账号锁，与账号停用及项目成员修改遵循相同锁顺序。 */
export async function loadV2Context(manager: EntityManager, identity: IdentityService, token: string, csrf?: string, selectedTeamId?: string | null): Promise<V2Context> {
  const repository = new OrganizationRepository(manager);
  await repository.lock();
  const auth = await identity.authenticate(manager, token, csrf);
  if (auth.account.must_change_password) throw new ForbiddenException('请先修改临时密码。');
  const actor: V2Actor = { id: auth.account.id, teamId: auth.account.team_id ?? null, disabled: Boolean(auth.account.disabled), isSuperAdmin: Boolean(auth.account.is_super_admin) };
  const organization = await repository.snapshot();

  // 团队范围不改变真实账号归属，读写均重验当前系统角色和团队范围。
  if (selectedTeamId && !actor.isSuperAdmin && selectedTeamId !== actor.teamId) throw new ForbiddenException('没有该团队的查看权限。');
  if (selectedTeamId && !organization.teams.some((team) => team.id === selectedTeamId)) throw new NotFoundException('团队不存在。');
  const teamId = actor.isSuperAdmin && selectedTeamId === null ? organization.teams[0]?.id ?? null : selectedTeamId ?? actor.teamId;
  const projects = organization.projects.map((project) => ({ id: project.id, teamId: project.teamId, teamLeaderId: organization.teams.find((team) => team.id === project.teamId)?.leaderId ?? '', members: project.members })).filter((project) => canViewProject(actor, project) && (selectedTeamId === undefined || project.teamId === teamId));
  return { actor, organization, projects, teamId, teamLeader: teamId !== null && (actor.isSuperAdmin || (teamId === actor.teamId && organization.teams.some((team) => team.id === teamId && team.leaderId === actor.id))) };
}

/** 重新从当前上下文查找项目，不允许用历史任务归属绕过成员撤权。 */
export function requireProject(context: V2Context, projectId: string): V2ProjectAccess {
  const project = context.projects.find((entry) => entry.id === projectId);
  if (!project) throw new ForbiddenException('没有当前项目访问权限。');
  return project;
}

/** 执行人限已启用的本项目成员；系统管理员也可将任务关联给本人，无需伪造成员关系。 */
export function requireProjectMember(context: V2Context, project: V2ProjectAccess, accountId: string): void {
  if (context.actor.isSuperAdmin && !context.actor.disabled && accountId === context.actor.id) return;
  if (!project.members.some((member) => member.accountId === accountId) || !context.organization.accounts.some((account) => account.id === accountId && account.teamId === project.teamId && !account.disabled)) throw new ForbiddenException('请选择本项目内已启用的成员。');
}

/** 所有聚合使用明确版本，事务锁只解决串行竞争，不代替乐观冲突提示。 */
export function requireVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new ConflictException('数据已被其他人修改，请保留草稿并刷新核对。');
}

/** 将纯领域校验转换成明确业务冲突；不将数据库错误文本返回客户端。 */
export function checkRule<T>(work: () => T): T {
  try { return work(); } catch (error) { throw new ConflictException(error instanceof Error ? error.message : '当前操作不满足业务规则。'); }
}
