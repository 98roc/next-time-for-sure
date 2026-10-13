import type { MigrationInterface, QueryRunner } from 'typeorm';
import { defaultPermissions } from '@ntfs/contracts';

/** 建立多小组及项目角色结构；账号只允许一个当前团队。 */
export class Organization1791849602000 implements MigrationInterface {
  name = 'Organization1791849602000';

  /** 表间使用外键保护引用，业务范围和负责人资格在事务内检查。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE teams (
      id CHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, leader_id CHAR(36) NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_team_leader FOREIGN KEY (leader_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query('ALTER TABLE accounts ADD COLUMN team_id CHAR(36) NULL, ADD CONSTRAINT fk_account_team FOREIGN KEY (team_id) REFERENCES teams(id)');
    await runner.query(`CREATE TABLE work_groups (
      id CHAR(36) NOT NULL PRIMARY KEY, team_id CHAR(36) NOT NULL, name VARCHAR(100) NOT NULL,
      leader_id CHAR(36) NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 0,
      CONSTRAINT fk_group_team FOREIGN KEY (team_id) REFERENCES teams(id),
      CONSTRAINT fk_group_leader FOREIGN KEY (leader_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE group_members (
      group_id CHAR(36) NOT NULL, account_id CHAR(36) NOT NULL, PRIMARY KEY (group_id, account_id),
      CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES work_groups(id),
      CONSTRAINT fk_gm_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE projects (
      id CHAR(36) NOT NULL PRIMARY KEY, team_id CHAR(36) NOT NULL, name VARCHAR(100) NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 0,
      CONSTRAINT fk_project_team FOREIGN KEY (team_id) REFERENCES teams(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE project_members (
      project_id CHAR(36) NOT NULL, account_id CHAR(36) NOT NULL, roles_json JSON NOT NULL,
      PRIMARY KEY (project_id, account_id), CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id),
      CONSTRAINT fk_pm_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await runner.query(`CREATE TABLE role_policies (
      role_name VARCHAR(40) NOT NULL PRIMARY KEY, permissions_json JSON NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const [role, permissions] of Object.entries(defaultPermissions)) await runner.query('INSERT INTO role_policies (role_name, permissions_json) VALUES (?, ?)', [role, JSON.stringify(permissions)]);
  }

  /** 不自动删除组织与角色历史。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
