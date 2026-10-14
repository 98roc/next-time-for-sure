import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { IdentityService } from '../identity/identity.service.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import type { PolicyActor } from '../organization/policy.js';

export type WorkAccess = { actor: PolicyActor; organization: OrganizationSnapshot };

/** 统一组织锁和当前身份校验，避免组织变动与业务写入交错。 */
export async function loadWorkAccess(manager: EntityManager, identity: IdentityService, token: string, csrf?: string): Promise<WorkAccess> {
  const repository = new OrganizationRepository(manager);
  await repository.lock();
  const auth = await identity.authenticate(manager, token, csrf);
  if (auth.account.must_change_password) throw new ForbiddenException('请先修改临时密码。');
  return { actor: { id: auth.account.id, teamId: auth.account.team_id ?? null, isSuperAdmin: Boolean(auth.account.is_super_admin) }, organization: await repository.snapshot() };
}

/** 项目成员或团队负责人可访问团队侧项目内容，超管不隐式获得业务权限。 */
export function projectAccess(access: WorkAccess, id: string) {
  const project = access.organization.projects.find((entry) => entry.id === id);
  if (!project || project.teamId !== access.actor.teamId) throw new ForbiddenException('没有项目访问权限。');
  const leader = access.organization.teams.some((team) => team.id === project.teamId && team.leaderId === access.actor.id);
  if (!leader && !project.members.some((member) => member.accountId === access.actor.id)) throw new ForbiddenException('没有项目访问权限。');
  return project;
}
/** 归档项目可读历史，但不能恢复或新增执行工作。 */
export function activeProject(access: WorkAccess, id: string) {
  const project = access.organization.projects.find((entry) => entry.id === id && entry.teamId === access.actor.teamId);
  if (!project) throw new ForbiddenException('没有当前团队项目权限。');
  if (project.archived) throw new ConflictException('项目已归档，请先恢复项目。');
  return project;
}
