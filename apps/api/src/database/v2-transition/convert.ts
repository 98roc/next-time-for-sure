import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { z } from 'zod';
import { migrationDecisionsSchema, readSource, type LegacySource, type MigrationDecisions } from './source.js';
import { buildPlan, dbTime, requireValue } from './plan.js';
import { addArrangementHistory, addTaskHistory } from './history.js';
import { addReportText } from './text.js';
import { addMilestoneHistory, addSharedOrder } from './objects.js';

const tables = ['v2_team_settings', 'v2_periods', 'v2_categories', 'v2_personal_views', 'v2_milestones', 'v2_tasks', 'v2_task_events', 'v2_arrangements', 'v2_arrangement_history', 'v2_backlog', 'v2_placements', 'v2_shared_orders', 'v2_report_texts', 'v2_object_events', 'v2_operations', 'v2_migration_map'];

/** 来源表按行内容排序后取摘要，不受数据库返回行顺序影响；保留字段内数组的业务顺序。 */
export function conversionSourceHash(legacy: LegacySource, decisions: MigrationDecisions): string {
  const rows = Object.fromEntries(Object.entries(legacy).map(([table, values]) => [table, values.map((row) => JSON.stringify(row)).sort()]));
  return createHash('sha256').update(JSON.stringify({ legacy: rows, decisions })).digest('hex');
}

/** 逐表、逐字段校验转换目标，阻止转换后有人修改数据时继续删来源。 */
export async function conversionTargetHash(db: EntityManager): Promise<string> {
  const canonical = (value: unknown): unknown => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  const hash = createHash('sha256');
  for (const table of tables) {
    const rows: unknown = await db.query(`SELECT * FROM ${table}`);
    hash.update(table).update(JSON.stringify(z.array(z.unknown()).parse(rows).map((row) => JSON.stringify(canonical(row))).sort()));
  }
  return hash.digest('hex');
}

/** 转换已备份的独立来源副本；正式入口必须先停写、备份并显式指定操作者及逐条例外。 */
export async function convertLegacy(source: DataSource, rawDecisions: unknown) {
  const decisions = migrationDecisionsSchema.parse(rawDecisions);
  return source.transaction('REPEATABLE READ', async (db) => {
    await db.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key='schema_baseline' FOR UPDATE");
    const legacy = await readSource(db);
    const fingerprint = conversionSourceHash(legacy, decisions);
    const previous = z.array(z.object({ metadata_value: z.string() })).parse(await db.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key='v2_conversion_source'"))[0];
    if (previous) {
      if (previous.metadata_value !== fingerprint) throw new Error('SOURCE_CHANGED_AFTER_CONVERSION');
      const target = z.array(z.object({ metadata_value: z.string() })).parse(await db.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key='v2_conversion_target'"))[0];
      if (target?.metadata_value !== await conversionTargetHash(db)) throw new Error('TARGET_CHANGED_AFTER_CONVERSION');
      return { repeated: true, sourceHash: fingerprint, counts: {}, warnings: [] };
    }
    // 不能静默覆盖先行录入的 V2 数据；正式切换须先关闭业务写入。
    for (const table of tables) {
      const { count } = requireValue(z.array(z.object({ count: z.coerce.number() })).parse(await db.query(`SELECT COUNT(*) count FROM ${table}`))[0], 'MISSING_COUNT');
      if (count !== 0) throw new Error('V2_TARGET_NOT_EMPTY');
    }
    const now = new Date().toISOString(), plan = buildPlan(legacy, decisions, now);
    addTaskHistory(plan, legacy, decisions, now); addArrangementHistory(plan, legacy, decisions, now); addReportText(plan, legacy, decisions, now);
    addMilestoneHistory(plan, legacy); addSharedOrder(plan, legacy);

    // 在真正落库前检查约束，不能把未知历史伪造成完成或重新打开目标。
    for (const milestone of plan.rows.get('v2_milestones') ?? []) if (milestone.status === 'completed' && (plan.rows.get('v2_tasks') ?? []).some((row) => row.milestone_id === milestone.id && row.status !== 'completed')) throw new Error('REVIEW_COMPLETED_MILESTONE');
    for (const task of plan.rows.get('v2_tasks') ?? []) if (task.kind === 'project' && !(plan.rows.get('v2_arrangements') ?? []).some((row) => row.task_id === task.id)) throw new Error('FORMAL_TASK_REQUIRES_PERIOD');
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = plan.rows.get(table) ?? []; counts[table] = rows.length;
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('INVALID_PLAN_COLUMN');
        await db.query(`INSERT INTO ${table} (${columns.map((column) => `\`${column}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map((column) => { const value = row[column]; if (value === undefined) throw new Error('MISSING_PLAN_VALUE'); return value; }));
      }
    }
    await db.query("INSERT INTO platform_metadata(metadata_key,metadata_value,created_at) VALUES ('v2_conversion_source',?,?)", [fingerprint, dbTime(now)]);
    await db.query("INSERT INTO platform_metadata(metadata_key,metadata_value,created_at) VALUES ('v2_conversion_target',?,?)", [await conversionTargetHash(db), dbTime(now)]);
    return { repeated: false, sourceHash: fingerprint, counts, warnings: plan.warnings };
  });
}
