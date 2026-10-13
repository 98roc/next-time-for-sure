import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { organizationSnapshotSchema, projectRoleSchema, rolePolicySchema } from '@ntfs/contracts';
import type { OrganizationSnapshot, Permission, Role } from '@ntfs/contracts';
import { z } from 'zod';

/** 组织模块数据访问集中管理；仅在服务校验身份和范围后写入。 */
export class OrganizationRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 小团队管理命令按基线行串行化，配合版本号拒绝过期编辑。 */
  async lock(): Promise<void> { await this.manager.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key = 'schema_baseline' FOR UPDATE"); }

  /** 一次事务读取完整组织关系，服务层在返回前按当前身份裁剪。 */
  async snapshot(): Promise<OrganizationSnapshot> {
    const accounts: unknown = await this.manager.query('SELECT id, login_name AS loginName, display_name AS displayName, team_id AS teamId, disabled, version FROM accounts WHERE is_super_admin = 0 FOR UPDATE');
    const teams: unknown = await this.manager.query('SELECT id, name, leader_id AS leaderId, version FROM teams');
    const groups: unknown = await this.manager.query('SELECT id, team_id AS teamId, name, leader_id AS leaderId, version FROM work_groups');
    const memberships: unknown = await this.manager.query('SELECT group_id AS groupId, account_id AS accountId FROM group_members');
    const projects: unknown = await this.manager.query('SELECT id, team_id AS teamId, name, version FROM projects');
    const projectMemberships: unknown = await this.manager.query('SELECT project_id AS projectId, account_id AS accountId, roles_json FROM project_members');
    const policies: unknown = await this.manager.query('SELECT role_name AS role, permissions_json, version FROM role_policies');
    const gm = z.array(z.object({ groupId: z.string(), accountId: z.string() })).parse(memberships);
    const pm = z.array(z.object({ projectId: z.string(), accountId: z.string(), roles_json: z.unknown() })).parse(projectMemberships);
    const policyRows = z.array(z.object({ role: z.string(), permissions_json: z.unknown(), version: z.number() })).parse(policies);
    const groupRows = z.array(z.object({ id: z.string(), teamId: z.string(), name: z.string(), leaderId: z.string(), version: z.number() })).parse(groups);
    const projectRows = z.array(z.object({ id: z.string(), teamId: z.string(), name: z.string(), version: z.number() })).parse(projects);
    const accountRows = z.array(z.object({ id: z.string(), loginName: z.string(), displayName: z.string(), teamId: z.string().nullable(), disabled: z.number(), version: z.number() })).parse(accounts);
    return organizationSnapshotSchema.parse({
      accounts: accountRows.map((row) => ({ ...row, disabled: Boolean(row.disabled) })), teams,
      groups: groupRows.map((row) => ({ ...row, memberIds: gm.filter((member) => member.groupId === row.id).map((member) => member.accountId) })),
      projects: projectRows.map((row) => ({ ...row, members: pm.filter((member) => member.projectId === row.id).map((member) => ({ accountId: member.accountId, roles: z.array(projectRoleSchema).parse(decodeJson(member.roles_json)) })) })),
      policies: policyRows.map((row) => rolePolicySchema.parse({ role: row.role, version: row.version, permissions: decodeJson(row.permissions_json) })),
    });
  }

  /** 创建账号；团队可空，仅用于建立团队负责人时的同一事务。 */
  async createAccount(login: string, display: string, hash: string, teamId: string | null): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO accounts (id, login_name, display_name, password_hash, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, login, display, hash, teamId]);
    return id;
  }

  /** 建立团队并关联同事务创建的负责人。 */
  async createTeam(name: string, leaderId: string): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO teams (id, name, leader_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [id, name, leaderId]);
    await this.assignTeam(leaderId, id);
    return id;
  }

  /** 账号归属变更由服务层检查现有团队，禁止隐式转移。 */
  async assignTeam(account: string, team: string): Promise<void> { await this.manager.query('UPDATE accounts SET team_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [team, account]); }

  /** 显式交接负责人并递增团队版本，不承接执行工作。 */
  async setLeader(team: string, account: string): Promise<void> { await this.manager.query('UPDATE teams SET leader_id = ?, version = version + 1 WHERE id = ?', [account, team]); }

  /** 小组成员多对多；替换成员列表不会触碰其他小组关系。 */
  async saveGroup(id: string | null, team: string, name: string, leader: string, members: string[]): Promise<string> {
    const target = id ?? randomUUID();
    if (id) await this.manager.query('UPDATE work_groups SET name = ?, leader_id = ?, version = version + 1 WHERE id = ?', [name, leader, target]);
    else await this.manager.query('INSERT INTO work_groups (id, team_id, name, leader_id) VALUES (?, ?, ?, ?)', [target, team, name, leader]);
    await this.manager.query('DELETE FROM group_members WHERE group_id = ?', [target]);
    for (const account of new Set(members)) await this.manager.query('INSERT INTO group_members (group_id, account_id) VALUES (?, ?)', [target, account]);
    return target;
  }

  /** 项目由团队归集，角色在成员关系上分别记录。 */
  async createProject(team: string, name: string): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO projects (id, team_id, name) VALUES (?, ?, ?)', [id, team, name]);
    return id;
  }

  /** 允许一人兼任多个项目角色；项目版本统一保护成员编辑。 */
  async setProjectMember(project: string, account: string, roles: string[]): Promise<void> {
    await this.manager.query('INSERT INTO project_members (project_id, account_id, roles_json) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE roles_json = VALUES(roles_json)', [project, account, JSON.stringify([...new Set(roles)])]);
    await this.manager.query('UPDATE projects SET version = version + 1 WHERE id = ?', [project]);
  }

  /** 管理员重置密码后要求本人改密，并撤销原会话。 */
  async resetPassword(account: string, hash: string): Promise<void> {
    await this.manager.query('UPDATE accounts SET password_hash = ?, must_change_password = 1, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [hash, account]);
    await this.manager.query('DELETE FROM login_sessions WHERE account_id = ?', [account]);
  }

  /** 禁用或启用均撤销旧会话，启用不恢复旧凭据。 */
  async setDisabled(account: string, disabled: boolean): Promise<void> {
    await this.manager.query('UPDATE accounts SET disabled = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [disabled ? 1 : 0, account]);
    await this.manager.query('DELETE FROM login_sessions WHERE account_id = ?', [account]);
  }

  /** 只更新已有预设角色，不能插入新角色或配置固定数据边界。 */
  async setPolicy(role: Role, permissions: Permission[]): Promise<void> { await this.manager.query('UPDATE role_policies SET permissions_json = ?, version = version + 1 WHERE role_name = ?', [JSON.stringify([...new Set(permissions)]), role]); }
}

/** mysql2对JSON列的返回可能是文本或已解析值，统一后再校验。 */
function decodeJson(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
