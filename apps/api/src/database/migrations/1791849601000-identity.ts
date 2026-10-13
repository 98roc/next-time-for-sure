import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 身份与会话持久化；只存密码派生值及会话摘要。 */
export class Identity1791849601000 implements MigrationInterface {
  name = 'Identity1791849601000';

  /** 建立账号、会话、认证节流及审计记录，使用显式时间避免5.7时间戳隐式行为。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE accounts (
      id CHAR(36) NOT NULL PRIMARY KEY, login_name VARCHAR(64) NOT NULL,
      display_name VARCHAR(100) NOT NULL, password_hash VARCHAR(255) NOT NULL,
      is_super_admin TINYINT NOT NULL DEFAULT 0, disabled TINYINT NOT NULL DEFAULT 0,
      must_change_password TINYINT NOT NULL DEFAULT 1, version INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_accounts_login (login_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE login_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY, account_id CHAR(36) NOT NULL,
      csrf_token CHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, expires_at DATETIME(3) NOT NULL,
      KEY idx_session_account (account_id), KEY idx_session_expiry (expires_at),
      CONSTRAINT fk_session_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE authentication_limits (
      bucket_hash CHAR(64) NOT NULL PRIMARY KEY, failures INT UNSIGNED NOT NULL DEFAULT 0,
      window_start DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE audit_events (
      id CHAR(36) NOT NULL PRIMARY KEY, actor_id CHAR(36) NOT NULL,
      action VARCHAR(64) NOT NULL, subject_id CHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL, KEY idx_audit_actor (actor_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  /** 账号数据不可通过自动降级删除。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
