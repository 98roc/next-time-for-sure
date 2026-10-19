import type { MigrationInterface, QueryRunner } from 'typeorm';
import { z } from 'zod';

/** 单条标语无损转成列表；兼容 MySQL DDL 中断后重跑，不覆盖已转换的值。 */
export class TeamMessages1792368002000 implements MigrationInterface {
  /** 停止旧 API 写入后执行：先承接旧值，再移除旧列并收紧非空约束。 */
  async up(runner: QueryRunner): Promise<void> {
    if (!await runner.hasColumn('v2_team_settings', 'messages_json')) {
      await runner.query("ALTER TABLE v2_team_settings ADD COLUMN messages_json JSON NULL COMMENT '我的工作首页标语列表，最多50条且每条最多500字符，空列表不展示'");
    }

    // 原文按原有空白规则处理，非空旧值完整保留为第一条标语。
    if (await runner.hasColumn('v2_team_settings', 'message')) {
      const rows = z.array(z.object({ teamId: z.string(), message: z.string() })).parse(await runner.query('SELECT team_id AS teamId,message FROM v2_team_settings WHERE messages_json IS NULL'));
      for (const row of rows) await runner.query('UPDATE v2_team_settings SET messages_json=? WHERE team_id=? AND messages_json IS NULL', [JSON.stringify(row.message.trim() ? [row.message.trim()] : []), row.teamId]);
      await runner.query('ALTER TABLE v2_team_settings DROP COLUMN message');
    }
    await runner.query('UPDATE v2_team_settings SET messages_json=JSON_ARRAY() WHERE messages_json IS NULL');
    await runner.query("ALTER TABLE v2_team_settings MODIFY COLUMN messages_json JSON NOT NULL COMMENT '我的工作首页标语列表，最多50条且每条最多500字符，空列表不展示'");
  }

  /** 列表不能无损退回单条，使用前向迁移修复。 */
  async down(): Promise<void> { throw new Error('Use a forward migration.'); }
}
