import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { WeeklyProjectOrder1792713601000 } from '../database/migrations/1792713601000-weekly-project-order.js';
import { decodeJson } from './repository-utils.js';

/** 专用连接的临时表遮蔽同名业务表，验证实际 MySQL 迁移而不修改现有团队排序。 */
export async function verifyWeeklyOrderMigration(source: DataSource): Promise<void> {
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    await runner.query(`CREATE TEMPORARY TABLE v2_shared_orders (
      team_id CHAR(36) NOT NULL COMMENT '测试团队',scope_key VARCHAR(120) NOT NULL COMMENT '测试排序作用域',
      ordered_ids JSON NOT NULL COMMENT '测试顺序',version INT UNSIGNED NOT NULL COMMENT '测试版本',
      manual_order TINYINT(1) NOT NULL COMMENT '测试手动标记',PRIMARY KEY(team_id,scope_key)
    ) COMMENT='排序迁移测试临时表'`);
    await runner.query(`CREATE TEMPORARY TABLE v2_periods (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '测试周期',team_id CHAR(36) NOT NULL COMMENT '测试团队',
      start_on DATE NOT NULL COMMENT '测试起始日',end_on DATE NOT NULL COMMENT '测试结束日'
    ) COMMENT='排序迁移测试周期临时表'`);
    const teamId = randomUUID(), fallbackTeam = randomUUID(), legacyTeam = randomUUID();
    const currentId = randomUUID(), futureId = randomUUID(), fallbackId = randomUUID();
    await runner.query(`INSERT INTO v2_periods(id,team_id,start_on,end_on) VALUES
      (?,?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),INTERVAL 6 DAY)),
      (?,?,'2099-01-01','2099-01-07'),(?,?,'2099-01-01','2099-01-07')`, [currentId, teamId, futureId, teamId, fallbackId, fallbackTeam]);
    const put = async (team: string, scope: string, ids: string[], version: number, manual: number) => runner.query('INSERT INTO v2_shared_orders(team_id,scope_key,ordered_ids,version,manual_order) VALUES (?,?,?,?,?)', [team, scope, JSON.stringify(ids), version, manual]);
    await put(teamId, `projects:${currentId}`, ['current'], 2, 1);
    await put(teamId, `projects:${futureId}`, ['future'], 9, 1);
    await put(fallbackTeam, `projects:${fallbackId}`, [], 4, 0);
    await put(legacyTeam, 'projects', ['legacy'], 3, 1);
    const migration = new WeeklyProjectOrder1792713601000();
    await migration.up(runner);
    const read = async (team: string) => {
      const rows = z.array(z.object({ ordered_ids: z.unknown(), version: z.number(), manual_order: z.number() })).parse(await runner.query("SELECT ordered_ids,version,manual_order FROM v2_shared_orders WHERE team_id=? AND scope_key='weekly:projects'", [team]));
      const row = rows[0]; assert.ok(row);
      return { ids: decodeJson(row.ordered_ids), version: row.version, manual: row.manual_order };
    };
    assert.deepEqual(await read(teamId), { ids: ['current'], version: 10, manual: 1 });
    assert.deepEqual(await read(fallbackTeam), { ids: [], version: 5, manual: 0 });
    assert.deepEqual(await read(legacyTeam), { ids: ['legacy'], version: 4, manual: 1 });
    await runner.query("UPDATE v2_shared_orders SET ordered_ids=?,version=11 WHERE team_id=? AND scope_key='weekly:projects'", [JSON.stringify(['changed']), teamId]);
    await migration.up(runner);
    assert.deepEqual(await read(teamId), { ids: ['changed'], version: 11, manual: 1 });
    const count = z.array(z.object({ total: z.coerce.number() })).parse(await runner.query('SELECT COUNT(*) AS total FROM v2_shared_orders'));
    assert.equal(count[0]?.total, 7);
    console.log('Weekly order migration MySQL verified: current period, fallback, reset, old keys, stale-version protection and repeat safety.');
  } finally {
    await runner.query('DROP TEMPORARY TABLE IF EXISTS v2_shared_orders,v2_periods');
    await runner.release();
  }
}
