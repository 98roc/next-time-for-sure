import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

const accountSchema = z.object({
  id: z.string(), login_name: z.string(), display_name: z.string(), password_hash: z.string(),
  is_super_admin: z.number(), disabled: z.number(), must_change_password: z.number(), version: z.number(),
  team_id: z.string().nullable().optional(),
});
export type AccountRow = z.infer<typeof accountSchema>;
const sessionSchema = z.object({ account_id: z.string(), csrf_token: z.string() });

/** 身份模块SQL集中于仓储；所有外部值都作为参数绑定。 */
export class IdentityRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 按唯一登录名锁定账号，防止改密与登录相互覆盖。 */
  async accountByLogin(login: string): Promise<AccountRow | undefined> {
    const rows: unknown = await this.manager.query('SELECT * FROM accounts WHERE login_name = ? FOR UPDATE', [login]);
    return z.array(accountSchema).parse(rows)[0];
  }

  /** 锁定当前账号以同步禁用、权限修改及会话撤销。 */
  async accountById(id: string): Promise<AccountRow | undefined> {
    const rows: unknown = await this.manager.query('SELECT * FROM accounts WHERE id = ? FOR UPDATE', [id]);
    return z.array(accountSchema).parse(rows)[0];
  }

  /** 仅接受尚未到期的会话，后续仍需核对账号当前状态。 */
  async session(hash: string, current = false) {
    const rows: unknown = await this.manager.query(`SELECT account_id, csrf_token FROM login_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)${current ? ' FOR UPDATE' : ''}`, [hash]);
    return z.array(sessionSchema).parse(rows)[0];
  }

  /** 会话创建与审计共用业务事务。 */
  async createSession(hash: string, account: string, csrf: string): Promise<void> {
    await this.manager.query('INSERT INTO login_sessions (token_hash, account_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 12 HOUR))', [hash, account, csrf]);
  }

  /** 改密撤销全部旧会话，更新版本及审计。 */
  async changePassword(id: string, hash: string): Promise<void> {
    await this.manager.query('UPDATE accounts SET password_hash = ?, must_change_password = 0, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [hash, id]);
    await this.manager.query('DELETE FROM login_sessions WHERE account_id = ?', [id]);
  }

  /** 主动退出撤销当前会话，不影响其他已登录设备。 */
  async revoke(hash: string): Promise<void> { await this.manager.query('DELETE FROM login_sessions WHERE token_hash = ?', [hash]); }

  /** 限制同一来源的登录尝试；事务提交后才返回认证失败，保留节流计数。 */
  async reserveAttempt(bucket: string): Promise<boolean> {
    await this.manager.query('INSERT IGNORE INTO authentication_limits (bucket_hash, failures, window_start) VALUES (?, 0, UTC_TIMESTAMP(3))', [bucket]);
    await this.manager.query('UPDATE authentication_limits SET failures = IF(window_start < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), 0, failures), window_start = IF(window_start < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), UTC_TIMESTAMP(3), window_start) WHERE bucket_hash = ?', [bucket]);
    const rows: unknown = await this.manager.query('SELECT failures FROM authentication_limits WHERE bucket_hash = ? FOR UPDATE', [bucket]);
    const count = z.array(z.object({ failures: z.number() })).parse(rows)[0]?.failures ?? 0;
    if (count >= 30) return false;
    await this.manager.query('UPDATE authentication_limits SET failures = failures + 1 WHERE bucket_hash = ?', [bucket]);
    return true;
  }

  /** 审计只记录事件及账号ID，不存密码、Cookie或请求体。 */
  async audit(actor: string, action: string, subject = actor): Promise<void> {
    await this.manager.query('INSERT INTO audit_events (id, actor_id, action, subject_id, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))', [randomUUID(), actor, action, subject]);
  }
}
