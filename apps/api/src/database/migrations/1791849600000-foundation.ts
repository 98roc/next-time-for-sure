import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 建立工程基线标识；不预建尚未实现的业务表，不自动修改已有结构。 */
export class Foundation1791849600000 implements MigrationInterface {
  name = 'Foundation1791849600000';

  /** 创建唯一的工程标识表并写入基线版本。 */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE platform_metadata (
      metadata_key VARCHAR(64) NOT NULL PRIMARY KEY,
      metadata_value VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(
      'INSERT INTO platform_metadata (metadata_key, metadata_value, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
      ['schema_baseline', 'foundation-v1'],
    );
  }

  /** MySQL DDL不会随事务自动回滚；不提供自动降级或删除数据命令。 */
  async down(): Promise<void> {
    throw new Error('Automatic schema downgrade is disabled; use a reviewed forward migration');
  }
}
