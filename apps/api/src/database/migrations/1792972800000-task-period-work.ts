import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 新增周期工作及自动顺延来源；保留历史审计，补录撤销仅标记无效。 */
export class TaskPeriodWork1792972800000 implements MigrationInterface {
  name = 'TaskPeriodWork1792972800000';

  async up(runner: QueryRunner): Promise<void> {
    for (const table of ['v2_arrangements', 'v2_arrangement_history']) {
      if (!await runner.hasColumn(table, 'work_note')) await runner.query(`ALTER TABLE ${table} ADD work_note VARCHAR(500) NOT NULL DEFAULT '' COMMENT '该周期工作内容，选填，人工维护不被顺延覆盖'`);
      if (!await runner.hasColumn(table, 'carried_from_period_id')) await runner.query(`ALTER TABLE ${table} ADD carried_from_period_id CHAR(36) NULL COMMENT '自动顺延来源周期，空表示人工安排，展示上期未完成'`);
    }
    if (!await runner.hasColumn('v2_arrangement_history', 'voided')) await runner.query("ALTER TABLE v2_arrangement_history ADD voided TINYINT(1) NOT NULL DEFAULT 0 COMMENT '补录完成时间纠正的自动安排为1，不进入周期总结，保留审计'");
    await runner.query("ALTER TABLE v2_arrangement_history MODIFY actor_id CHAR(36) NULL COMMENT '实际操作者，自动顺延为空' ");
    await runner.query("ALTER TABLE v2_task_events MODIFY actor_id CHAR(36) NULL COMMENT '实际操作者，系统顺延为空，不伪装执行人'");
  }

  async down(): Promise<void> { throw new Error('周期工作与顺延来源已保存业务数据，请使用备份恢复。'); }
}
