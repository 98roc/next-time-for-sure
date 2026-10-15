import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationCommand, OrganizationSnapshot, Permission } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { hashPassword } from '../identity/password.js';
import { OrganizationRepository } from './organization.repository.js';
import { hasPermission, visibleOrganization } from './policy.js';
import type { PolicyActor } from './policy.js';

/** 组织操作共用身份、作用范围、版本及事务，不依赖前端按钮显隐。 */
@Injectable()
export class OrganizationService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 获取当前用户可见的组织目录，未改临时密码时不开放管理功能。 */
  async snapshot(token: string): Promise<OrganizationSnapshot> {
    return this.database.transaction(async (manager) => {
      const repository = new OrganizationRepository(manager);
      await repository.lock();
      const auth = await this.identity.authenticate(manager, token);
      if (auth.account.must_change_password) throw new ForbiddenException('请先修改临时密码。');
      return visibleOrganization({ id: auth.account.id, teamId: auth.account.team_id ?? null, isSuperAdmin: Boolean(auth.account.is_super_admin) }, await repository.snapshot());
    });
  }

  /** 管理命令在同一事务内检查当前权限、输入成员范围、版本并记录审计。 */
  async execute(token: string, csrf: string, command: OrganizationCommand): Promise<void> {
    await this.database.transaction(async (manager) => {
      const repository = new OrganizationRepository(manager);
      await repository.lock();
      const auth = await this.identity.authenticate(manager, token, csrf);
      if (auth.account.must_change_password) throw new ForbiddenException('请先修改临时密码。');
      const actor = { id: auth.account.id, teamId: auth.account.team_id ?? null, isSuperAdmin: Boolean(auth.account.is_super_admin) };
      const snapshot = await repository.snapshot();

      // 先按命令作用域执行固定规则，成功后统一写审计。未知操作已在协议层拒绝。
      const subject = await executeCommand(repository, actor, snapshot, command);
      await new IdentityRepository(manager).audit(actor.id, `organization.${command.action}`, subject);
    });
  }
}

/** 所有写操作在上层已锁定的事务内执行，不允许调用方绕开校验直接写仓储。 */
async function executeCommand(repository: OrganizationRepository, actor: PolicyActor, snapshot: OrganizationSnapshot, command: OrganizationCommand): Promise<string> {
  const requireSuper = () => { if (!actor.isSuperAdmin) throw new ForbiddenException('仅超管可执行此操作。'); };
  const requirePermission = (teamId: string, permission: Permission) => {
    if (actor.isSuperAdmin) throw new ForbiddenException('团队内部管理由团队管理员操作。');
    if (!snapshot.teams.some((team) => team.id === teamId)) throw new NotFoundException('团队不存在。');
    if (!hasPermission(actor, snapshot, permission, { teamId })) throw new ForbiddenException('没有本团队的操作权限。');
  };
  const member = (id: string, teamId: string) => {
    const account = snapshot.accounts.find((item) => item.id === id && item.teamId === teamId && !item.disabled);
    if (!account) throw new BadRequestException('请选择本团队内未禁用的成员。');
    return account;
  };
  const fresh = (actual: number, expected: number) => { if (actual !== expected) throw new ConflictException('数据已被修改，请刷新后重新操作。'); };
  const uniqueLogin = async (login: string, except?: string) => { if (await repository.loginExists(login, except)) throw new ConflictException('账号已存在，请使用其他登录名或关联已有账号。'); };
  const accountById = (id: string) => {
    const account = snapshot.accounts.find((item) => item.id === id);
    if (!account) throw new NotFoundException('账号不存在或不可操作。');
    return account;
  };

  switch (command.action) {
    case 'create_account':
      requireSuper(); await uniqueLogin(command.loginName);
      return repository.createAccount(command.loginName, command.displayName, await hashPassword(command.password), null);
    case 'update_account': {
      requireSuper();
      const account = accountById(command.accountId);
      fresh(account.version, command.version); await uniqueLogin(command.loginName, account.id);
      await repository.updateAccount(account.id, command.loginName, command.displayName); return account.id;
    }
    case 'delete_account': {
      requireSuper();
      const account = accountById(command.accountId); fresh(account.version, command.version);
      if (account.teamId || await repository.accountInUse(account.id)) throw new ConflictException('账号已有团队关联或工作记录，不能删除，请使用停用。');
      await repository.deleteAccount(account.id); return account.id;
    }
    case 'create_team': {
      requireSuper();
      const leader = accountById(command.leaderId);
      if (leader.disabled || leader.teamId) throw new ConflictException('请选择已启用且尚未加入团队的账号作为团队管理员。');
      return repository.createTeam(command.name, leader.id);
    }
    case 'update_team': {
      requireSuper();
      const team = snapshot.teams.find((item) => item.id === command.teamId);
      if (!team) throw new NotFoundException('团队不存在。');
      fresh(team.version, command.version);
      const leader = accountById(command.leaderId);
      if (leader.disabled || (leader.teamId !== null && leader.teamId !== team.id)) throw new ConflictException('团队管理员须为已启用的本团队成员或未入团队账号。');
      if (!leader.teamId) await repository.assignTeam(leader.id, team.id);
      await repository.updateTeam(team.id, command.name, leader.id); return team.id;
    }
    case 'delete_team': {
      requireSuper();
      const team = snapshot.teams.find((item) => item.id === command.teamId);
      if (!team) throw new NotFoundException('团队不存在。');
      fresh(team.version, command.version);
      if (snapshot.accounts.some((account) => account.teamId === team.id && account.id !== team.leaderId) || await repository.teamInUse(team.id)) throw new ConflictException('团队仍有成员、小组、项目或业务历史，不能删除。');
      await repository.deleteTeam(team.id); return team.id;
    }
    case 'create_member':
      requirePermission(command.teamId, 'members.manage'); await uniqueLogin(command.loginName);
      return repository.createAccount(command.loginName, command.displayName, await hashPassword(command.password), command.teamId);
    case 'link_member': {
      requirePermission(command.teamId, 'members.manage');
      const account = snapshot.accounts.find((item) => item.loginName.toLowerCase() === command.loginName.toLowerCase());
      if (!account || account.disabled) throw new BadRequestException('账号不存在或不可用。');
      if (account.teamId === command.teamId) return account.id;
      if (account.teamId) throw new ConflictException('账号已有团队，需按成员转移流程处理。');
      await repository.assignTeam(account.id, command.teamId); return account.id;
    }
    case 'set_leader': {
      requireSuper();
      const team = snapshot.teams.find((item) => item.id === command.teamId);
      if (!team) throw new NotFoundException('团队不存在。');
      member(command.accountId, command.teamId); fresh(team.version, command.version);
      await repository.setLeader(team.id, command.accountId); return team.id;
    }
    case 'create_group':
    case 'update_group': {
      const existing = command.action === 'update_group' ? snapshot.groups.find((group) => group.id === command.groupId) : undefined;
      const teamId = command.action === 'create_group' ? command.teamId : existing?.teamId;
      if (!teamId) throw new NotFoundException('小组不存在。');
      requirePermission(teamId, 'groups.manage');
      if (command.action === 'update_group' && existing) fresh(existing.version, command.version);
      if (!command.memberIds.includes(command.leaderId)) throw new BadRequestException('组长必须在小组成员中。');
      for (const accountId of command.memberIds) member(accountId, teamId);
      return repository.saveGroup(existing?.id ?? null, teamId, command.name, command.leaderId, command.memberIds);
    }
    case 'create_project': {
      requirePermission(command.teamId, 'projects.manage');
      for (const accountId of [command.managerId, command.leadId, ...command.developerIds]) member(accountId, command.teamId);
      const project = await repository.createProject(command.teamId, command.name);
      for (const accountId of new Set([command.managerId, command.leadId, ...command.developerIds])) {
        const roles: string[] = [];
        if (accountId === command.managerId) roles.push('project_manager');
        if (accountId === command.leadId) roles.push('project_lead');
        if (command.developerIds.includes(accountId)) roles.push('developer');
        await repository.setProjectMember(project, accountId, roles);
      }
      return project;
    }
    case 'set_project_member':
    case 'set_project_members': {
      const project = snapshot.projects.find((item) => item.id === command.projectId);
      if (!project) throw new NotFoundException('项目不存在。');
      requirePermission(project.teamId, 'projects.manage'); fresh(project.version, command.version);
      const changes = command.action === 'set_project_member' ? [{ accountId: command.accountId, roles: command.roles }] : command.members;
      // 先校验整批成员及最终角色集合，再在同一事务写入；允许一次完成负责人交接。
      for (const entry of changes) member(entry.accountId, project.teamId);
      const changedIds = new Set(changes.map((entry) => entry.accountId));
      const finalRoles = [...project.members.filter((entry) => !changedIds.has(entry.accountId)), ...changes].flatMap((entry) => entry.roles);
      const requiredRoles: Array<'project_manager' | 'project_lead'> = ['project_manager', 'project_lead'];
      for (const role of requiredRoles) if (!finalRoles.includes(role)) throw new BadRequestException('项目必须保留项目经理和研发负责人。');
      for (const entry of changes) await repository.setProjectMember(project.id, entry.accountId, entry.roles);
      return project.id;
    }
    case 'reset_password':
    case 'set_disabled': {
      const account = snapshot.accounts.find((item) => item.id === command.accountId);
      if (!account || account.id === actor.id) throw new BadRequestException('不能通过此入口操作本人或超管账号。');
      if (!actor.isSuperAdmin) {
        if (!account.teamId) throw new ForbiddenException('没有账号管理权限。');
        requirePermission(account.teamId, 'members.manage');
      }
      fresh(account.version, command.version);
      if (command.action === 'reset_password') await repository.resetPassword(account.id, await hashPassword(command.password));
      else await repository.setDisabled(account.id, command.disabled);
      return account.id;
    }
  }
}
