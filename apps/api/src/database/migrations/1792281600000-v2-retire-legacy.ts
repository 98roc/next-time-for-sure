import type { MigrationInterface, QueryRunner } from 'typeorm';
import { z } from 'zod';

/** 独立切换阶段显式执行；普通 db:migrate 不删除旧业务来源。 */
export class V2RetireLegacy1792281600000 implements MigrationInterface {
  name = 'V2RetireLegacy1792281600000';

  /** 必须先转换、回读并登记备份；按外键顺序删除，支持 DDL 中断后按同一记录重试。 */
  async up(runner: QueryRunner): Promise<void> {
    const metadata = z.array(z.object({ metadata_key: z.string(), metadata_value: z.string() })).parse(await runner.query("SELECT metadata_key,metadata_value FROM platform_metadata WHERE metadata_key IN ('v2_retirement_ready','v2_retirement_backup')"));
    if (metadata.length !== 2 || metadata.some((row) => !/^[a-f0-9]{64}$/.test(row.metadata_value))) throw new Error('Verified conversion and backup are required before retirement');
    // MySQL DDL 不能事务回滚；成功后再更新基线，失败只能继续同一迁移或完整恢复备份。
    for (const table of ['notifications', 'notification_outbox', 'lifecycle_events', 'personal_progress', 'personal_events', 'personal_items', 'personal_categories', 'assignment_progress', 'weekly_arrangements', 'weekly_pending', 'weekly_carry_exclusions', 'weekly_events', 'weekly_publications', 'report_drafts', 'weekly_drafts', 'task_assignments', 'team_tasks', 'project_milestones', 'work_requests', 'work_events', 'work_operations', 'work_tags', 'group_members', 'work_groups', 'role_policies']) await runner.query(`DROP TABLE IF EXISTS ${table}`);
    if (await runner.hasColumn('projects', 'archived')) await runner.query('ALTER TABLE projects DROP COLUMN archived');
    await runner.query("UPDATE platform_metadata SET metadata_value='v2' WHERE metadata_key='schema_baseline'");
  }

  /** 恢复须同时恢复应用及完整业务库，不重建空旧表掩盖数据丢失。 */
  async down(): Promise<void> { throw new Error('Restore the verified full database backup and matching application version'); }
}
