import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { personalTokensSchema } from '@ntfs/contracts';

/** Token SQL集中管理，列表和错误永不包含摘要或明文。 */
export class TokenRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 账号锁前先查询所属身份，拿到账号锁后再以当前读检查撤销。 */
  async active(hash: string, lock = false) {
    const rows: unknown = await this.manager.query(`SELECT account_id AS accountId FROM personal_tokens WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))${lock ? ' FOR UPDATE' : ''}`, [hash]);
    return z.array(z.object({ accountId: z.string() })).parse(rows)[0];
  }
  /** 展示元数据，不向本人回显已保存的凭据。 */
  async list(account: string) {
    return personalTokensSchema.parse(await this.manager.query("SELECT id,name,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,DATE_FORMAT(revoked_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS revokedAt FROM personal_tokens WHERE account_id=? ORDER BY created_at DESC", [account]));
  }
  /** 明文由服务生成且仅用于本次响应。 */
  async create(id: string, account: string, name: string, hash: string, expiresAt: string | null) {
    await this.manager.query('INSERT INTO personal_tokens (id,account_id,name,token_hash,created_at,expires_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3),?)', [id, account, name, hash, expiresAt ? new Date(expiresAt) : null]);
  }
  /** 重复撤销保持首次时间。 */
  async revoke(account: string, id: string) { await this.manager.query('UPDATE personal_tokens SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)) WHERE id=? AND account_id=?', [id, account]); }
}
