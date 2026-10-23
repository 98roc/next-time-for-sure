import type { MigrationInterface, QueryRunner } from 'typeorm';
import { z } from 'zod';
import { decodeJson } from '../../v2/repository-utils.js';

/** 跨周期共用项目顺序，优先承接上海当前周期；没有时使用日期最近的已保存周期。 */
export class WeeklyProjectOrder1792713601000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // 旧表没有排序修改时间，不能推断最后操作；当前周期优先，其余按周期日期倒序。
    // 极早版本只有 projects 键时兜底承接；保留全部旧记录，且重跑不覆盖新作用域。
    const rows = z.array(z.object({ teamId: z.string(), orderedIds: z.unknown(), version: z.number(), manual: z.coerce.boolean() })).parse(await runner.query(`
      SELECT o.team_id AS teamId,o.ordered_ids AS orderedIds,o.version,o.manual_order AS manual
      FROM v2_shared_orders o
      LEFT JOIN v2_periods p ON p.team_id=o.team_id AND o.scope_key=CONCAT('projects:',p.id)
      WHERE p.id IS NOT NULL OR o.scope_key='projects'
      ORDER BY o.team_id,
        CASE WHEN DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)) BETWEEN p.start_on AND p.end_on THEN 0 ELSE 1 END,
        p.start_on DESC,o.scope_key`));
    const selected = new Set<string>();
    for (const row of rows) {
      if (selected.has(row.teamId)) continue;
      selected.add(row.teamId);
      const ids = z.array(z.string()).parse(decodeJson(row.orderedIds));
      const version = Math.max(...rows.filter((entry) => entry.teamId === row.teamId).map((entry) => entry.version)) + 1;
      await runner.query('INSERT IGNORE INTO v2_shared_orders(team_id,scope_key,ordered_ids,version,manual_order) VALUES (?,?,?,?,?)', [row.teamId, 'weekly:projects', JSON.stringify(ids), version, Number(row.manual)]);
    }
  }

  /** 已共享的排序不能无损拆回每个周期，保留数据并使用前向迁移。 */
  async down(): Promise<void> { throw new Error('Use a forward migration.'); }
}
