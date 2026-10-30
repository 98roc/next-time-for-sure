import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 任务级备注独立于周期工作；旧任务留空，不从旧版说明或周期内容回填。 */
export class TaskRemark1793322000000 implements MigrationInterface {
  name = 'TaskRemark1793322000000';

  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_tasks', 'remark')) await runner.query("ALTER TABLE v2_tasks ADD remark TEXT NULL COMMENT '任务备注，选填纯文本，最多5000字符，NULL或空串表示未填写，由管理者或当前执行人维护' AFTER title");
  }

  async down(): Promise<void> { throw new Error('任务备注已保存业务事实，请使用备份恢复。'); }
}
