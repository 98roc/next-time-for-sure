import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 原项目表未记创建时间；只采信创建事件，缺失时保留空，不使用修改或迁移时刻。 */
export class ProjectCreatedAt1792368001000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE projects ADD COLUMN created_at DATETIME(3) NULL DEFAULT NULL COMMENT '项目创建时间，协调世界时；旧项目无创建证据时为空并排在已知时间之后'");
    await runner.query(`UPDATE projects p LEFT JOIN (
      SELECT subject_id AS project_id, MIN(created_at) AS created_at FROM audit_events WHERE action='organization.create_project' GROUP BY subject_id
    ) a ON a.project_id=p.id LEFT JOIN (
      SELECT project_id, MIN(occurred_at) AS created_at FROM v2_object_events WHERE action='project.configured' AND JSON_TYPE(JSON_EXTRACT(payload_json,'$.before'))='NULL' GROUP BY project_id
    ) v ON v.project_id=p.id SET p.created_at=CASE WHEN a.created_at IS NULL THEN v.created_at WHEN v.created_at IS NULL THEN a.created_at ELSE LEAST(a.created_at,v.created_at) END`);
  }

  /** 业务创建证据只允许通过前向迁移维护。 */
  async down(): Promise<void> { throw new Error('Use a forward migration.'); }
}
