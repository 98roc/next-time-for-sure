import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { organizationSnapshotSchema, projectRoleSchema } from '@ntfs/contracts';
import type { OrganizationSnapshot } from '@ntfs/contracts';
import { z } from 'zod';

/** 组织模块数据访问集中管理；仅在服务校验身份和范围后写入。 */
export class OrganizationRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 小团队管理命令按基线行串行化，配合版本号拒绝过期编辑。 */
  async lock(): Promise<void> { await this.manager.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key = 'schema_baseline' FOR UPDATE"); }

  /** 一次事务读取完整组织关系，服务层在返回前按当前身份裁剪。 */
  async snapshot(): Promise<OrganizationSnapshot> {
    // 账号与成员目录统一按创建时间倒序；同一毫秒创建时用ID稳定排序。
    const accounts: unknown = await this.manager.query('SELECT id, login_name AS loginName, display_name AS displayName, team_id AS teamId, disabled, version FROM accounts WHERE is_super_admin = 0 ORDER BY created_at DESC, id ASC FOR UPDATE');
    const teams: unknown = await this.manager.query('SELECT id, name, leader_id AS leaderId, version FROM teams');
    const projects: unknown = await this.manager.query('SELECT id, team_id AS teamId, name, version FROM projects');
    const projectMemberships: unknown = await this.manager.query('SELECT project_id AS projectId, account_id AS accountId, roles_json FROM project_members');
    const pm = z.array(z.object({ projectId: z.string(), accountId: z.string(), roles_json: z.unknown() })).parse(projectMemberships);
    const projectRows = z.array(z.object({ id: z.string(), teamId: z.string(), name: z.string(), version: z.number() })).parse(projects);
    const accountRows = z.array(z.object({ id: z.string(), loginName: z.string(), displayName: z.string(), teamId: z.string().nullable(), disabled: z.number(), version: z.number() })).parse(accounts);
    return organizationSnapshotSchema.parse({
      accounts: accountRows.map((row) => ({ ...row, disabled: Boolean(row.disabled) })), teams,
      projects: projectRows.map((row) => ({ ...row, members: pm.filter((member) => member.projectId === row.id).map((member) => ({ accountId: member.accountId, roles: z.array(projectRoleSchema).parse(decodeJson(member.roles_json)) })) })),
    });
  }

  /** 超管创建独立账号，团队归属由后续关联操作维护。 */
  async createAccount(login: string, display: string, hash: string, teamId: string | null): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO accounts (id, login_name, display_name, password_hash, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [id, login, display, hash, teamId]);
    return id;
  }

  /** 建立团队并关联已有的未入团队账号。 */
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

  /** 新版项目服务在校验整份成员配置后创建项目基础记录。 */
  async createProject(team: string, name: string): Promise<string> {
    const id = randomUUID();
    await this.manager.query('INSERT INTO projects (id, team_id, name) VALUES (?, ?, ?)', [id, team, name]);
    return id;
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

  /** 包括超管在内检查登录名，避免唯一索引冲突泄漏为内部错误。 */
  async loginExists(login: string, except = ''): Promise<boolean> {
    const rows: unknown = await this.manager.query('SELECT id FROM accounts WHERE login_name = ? AND id <> ? LIMIT 1', [login, except]);
    return z.array(z.object({ id: z.string() })).parse(rows).length > 0;
  }

  /** 修改身份资料并递增版本，不隐式调整团队归属。 */
  async updateAccount(id: string, login: string, display: string): Promise<void> {
    await this.manager.query('UPDATE accounts SET login_name = ?, display_name = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [login, display, id]);
  }

  /** 一次保存团队名称与管理员，已有关联由服务校验。 */
  async updateTeam(id: string, name: string, leaderId: string): Promise<void> {
    await this.manager.query('UPDATE teams SET name = ?, leader_id = ?, version = version + 1 WHERE id = ?', [name, leaderId, id]);
  }

  /** 检查业务关联及无外键历史；只返回存在性，不暴露私人内容。 */
  async accountInUse(id: string): Promise<boolean> {
    const references = [
      ['v2_arrangement_history', 'actor_id'], ['v2_backlog', 'converted_by'], ['v2_report_texts', 'updated_by'], ['v2_personal_views', 'owner_id'],
      ['v2_tasks', 'creator_id'], ['v2_tasks', 'executor_id'], ['v2_backlog', 'creator_id'], ['v2_milestones', 'owner_id'], ['v2_categories', 'owner_id'], ['v2_task_events', 'actor_id'], ['v2_object_events', 'actor_id'], ['v2_operations', 'actor_id'], ['teams', 'leader_id'], ['work_groups', 'leader_id'], ['group_members', 'account_id'], ['project_members', 'account_id'],
      ['work_requests', 'submitter_id'], ['team_tasks', 'owner_id'], ['project_milestones', 'owner_id'], ['task_assignments', 'account_id'],
      ['personal_categories', 'owner_id'], ['personal_items', 'owner_id'], ['personal_events', 'owner_id'],
      ['work_events', 'actor_id'], ['work_operations', 'actor_id'], ['weekly_events', 'actor_id'],
      ['lifecycle_events', 'actor_id'], ['lifecycle_events', 'object_id'], ['notifications', 'account_id'],
    ];
    return this.hasReferences(references, id);
  }

  /** 团队的项目、小组及历史存在时拒绝删除，避免级联清理业务数据。 */
  async teamInUse(id: string): Promise<boolean> {
    return this.hasReferences(['v2_team_settings', 'v2_periods', 'v2_tasks', 'v2_report_texts', 'v2_object_events', 'work_groups', 'projects', 'weekly_drafts', 'weekly_publications', 'report_drafts', 'weekly_events', 'lifecycle_events', 'notification_outbox'].map((table) => [table, 'team_id']), id);
  }

  /** 仅用于本文件固定表列清单，不接受外部输入作为SQL标识符。 */
  private async hasReferences(references: string[][], id: string): Promise<boolean> {
    // 旧表仅在转换过渡期存在；切换后不查询已删除表，也不恢复取消功能。
    const existing = z.array(z.object({ name: z.string() })).parse(await this.manager.query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"));
    const names = new Set(existing.map((row) => row.name));
    for (const [table, column] of references) {
      if (!table) throw new Error('Missing reference table');
      if (!names.has(table)) { if (table.startsWith('v2_')) throw new Error('V2 schema incomplete'); continue; }
      const rows: unknown = await this.manager.query(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? LIMIT 1`, [id]);
      if (z.array(z.object({ found: z.coerce.number() })).parse(rows).length) return true;
    }
    return false;
  }

  /** 只删除服务已确认无业务关联的账号；审计不随账号删除。 */
  async deleteAccount(id: string): Promise<void> {
    await this.manager.query('DELETE FROM login_sessions WHERE account_id = ?', [id]);
    await this.manager.query('DELETE FROM personal_tokens WHERE account_id = ?', [id]);
    await this.manager.query('DELETE FROM accounts WHERE id = ?', [id]);
  }

  /** 空团队删除前解除唯一管理员的团队归属，账号本身保留。 */
  async deleteTeam(id: string): Promise<void> {
    await this.manager.query('UPDATE accounts SET team_id = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE team_id = ?', [id]);
    await this.manager.query('DELETE FROM teams WHERE id = ?', [id]);
  }
}

/** mysql2对JSON列的返回可能是文本或已解析值，统一后再校验。 */
function decodeJson(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
