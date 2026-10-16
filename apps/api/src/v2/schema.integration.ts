import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';

/** 只在已核对的本机库验证真实唯一键、外键和精确投入；全部夹具置于最终回滚的事务。 */
async function verifySchema(): Promise<void> {
  const environment = loadEnvironment();
  if (!['127.0.0.1', 'localhost', '::1'].includes(environment.DB_HOST)) throw new Error('V2 schema smoke only accepts a local development database');
  const source = createDataSource(environment);
  await source.initialize();
  const runner = source.createQueryRunner();
  const ownerId = randomUUID(), teamId = randomUUID(), otherTeam = randomUUID(), projectId = randomUUID(), taskId = randomUUID(), periodId = randomUUID(), foreignPeriod = randomUUID(), categoryId = randomUUID();
  try {
    await runner.connect();
    await runner.startTransaction();

    // 所有临时账号不可登录且从不提交，不触碰现有账号、业务及会话。
    await runner.query('INSERT INTO accounts (id,login_name,display_name,password_hash,disabled,created_at,updated_at) VALUES (?,?,?,?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [ownerId, `v2.${ownerId}`, 'V2结构回滚夹具', 'unusable-test-fixture']);
    for (const id of [teamId, otherTeam]) await runner.query('INSERT INTO teams (id,name,leader_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [id, 'V2结构回滚夹具', ownerId]);
    await runner.query('INSERT INTO projects (id,team_id,name) VALUES (?,?,?)', [projectId, teamId, 'V2结构回滚夹具']);
    for (const [id, team] of [[periodId, teamId], [foreignPeriod, otherTeam]]) await runner.query('INSERT INTO v2_periods (id,team_id,start_on,end_on) VALUES (?,?,?,?)', [id, team, '2026-10-12', '2026-10-18']);
    await runner.query(`INSERT INTO v2_tasks (id,kind,team_id,project_id,creator_id,executor_id,title,history_known_from,created_at,updated_at)
      VALUES (?,'project',?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [taskId, teamId, projectId, ownerId, ownerId, '真实外键验收']);
    await runner.query('INSERT INTO v2_arrangements (task_id,period_id,team_id,planned_days) VALUES (?,?,?,?)', [taskId, periodId, teamId, '1.25']);

    // 数据库约束独立于服务检查：禁止跨团队安排、重复安排和两个默认分类。
    const databaseError = (code: string) => (error: unknown) => z.object({ driverError: z.object({ code: z.literal(code) }) }).safeParse(error).success;
    await assert.rejects(runner.query('INSERT INTO v2_arrangements (task_id,period_id,team_id) VALUES (?,?,?)', [taskId, foreignPeriod, teamId]), databaseError('ER_NO_REFERENCED_ROW_2'));
    await assert.rejects(runner.query('INSERT INTO v2_arrangements (task_id,period_id,team_id) VALUES (?,?,?)', [taskId, periodId, teamId]), databaseError('ER_DUP_ENTRY'));
    await runner.query('INSERT INTO v2_categories (id,owner_id,name,status,is_default) VALUES (?,?,?,\'not_started\',1)', [categoryId, ownerId, '默认分类']);
    await assert.rejects(runner.query('INSERT INTO v2_categories (id,owner_id,name,status,is_default) VALUES (?,?,?,\'not_started\',1)', [randomUUID(), ownerId, '冲突分类']), databaseError('ER_DUP_ENTRY'));
    await runner.query('INSERT INTO v2_categories (id,owner_id,name,status,is_default) VALUES (?,?,?,\'not_started\',0)', [randomUUID(), ownerId, '同状态分类']);
    await runner.query('INSERT INTO v2_placements (task_id,owner_id,category_id,position) VALUES (?,?,?,0)', [taskId, ownerId, categoryId]);
    const days = z.array(z.object({ planned_days: z.coerce.number() })).parse(await runner.query('SELECT planned_days FROM v2_arrangements WHERE task_id=?', [taskId]));
    assert.equal(days[0]?.planned_days, 1.25);
    await runner.query('UPDATE v2_arrangements SET planned_days=NULL WHERE task_id=?', [taskId]);
    assert.equal(z.array(z.object({ planned_days: z.null() })).parse(await runner.query('SELECT planned_days FROM v2_arrangements WHERE task_id=?', [taskId])).length, 1);

    // 实际回读中文注释，包含生成列和历史迁移新增表，而不是只检查 SQL 源码。
    const comments = z.array(z.object({ object_name: z.string(), comment_text: z.string() })).parse(await runner.query(`
      SELECT TABLE_NAME AS object_name,TABLE_COMMENT AS comment_text FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,3)='v2_'
      UNION ALL SELECT CONCAT(TABLE_NAME,'.',COLUMN_NAME),COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,3)='v2_'`));
    assert.equal(comments.filter((entry) => !/[\u4e00-\u9fff]/u.test(entry.comment_text)).length, 0);
    await runner.rollbackTransaction();
    const leftovers = z.array(z.object({ count: z.coerce.number() })).parse(await source.query('SELECT COUNT(*) AS count FROM accounts WHERE id=?', [ownerId]));
    assert.equal(leftovers[0]?.count, 0);
    console.log(`V2 schema smoke passed: real MySQL constraints, null/decimal estimates, ${comments.length} Chinese comments; transaction rolled back and fixture absence verified.`);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
}

void verifySchema().catch(() => { console.error('V2 schema smoke failed; inspect local schema and migration status. Credentials and SQL parameters are not logged.'); process.exitCode = 1; });
