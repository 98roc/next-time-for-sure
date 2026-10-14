import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Token与浏览器会话独立，永久有效不免除账号和权限检查。 */
export class PersonalTokens1791849615000 implements MigrationInterface {
  name = 'PersonalTokens1791849615000';
  /** 只持久化随机Token摘要，撤销保留元数据供本人核对。 */
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE personal_tokens (
      id CHAR(36) PRIMARY KEY COMMENT '个人访问凭据标识',
      account_id CHAR(36) NOT NULL COMMENT '凭据所属账号，每次使用重新验证当前权限',
      name VARCHAR(100) NOT NULL COMMENT '本人填写的用途名称',
      token_hash CHAR(64) NOT NULL COMMENT '随机凭据的SHA256摘要，不存明文',
      created_at DATETIME(3) NOT NULL COMMENT '生成时间，协调世界时',
      expires_at DATETIME(3) NULL COMMENT '到期时间，空表示本人确认永久有效',
      revoked_at DATETIME(3) NULL COMMENT '撤销时间，非空即不可认证',
      UNIQUE KEY uq_personal_token_hash(token_hash), KEY idx_personal_token_account(account_id),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人访问Token摘要及生命周期，不授予独立业务权限'`);
  }
  /** 凭据记录不通过自动降级删除。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
