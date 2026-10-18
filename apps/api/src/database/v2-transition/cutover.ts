import assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { conversionSourceHash, conversionTargetHash, convertLegacy } from './convert.js';
import { migrationDecisionsSchema, readSource } from './source.js';
import { prepareRetirement } from './retire.js';

export const cutoverInputSchema = z.object({
  decisions: migrationDecisionsSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z.record(z.string().regex(/^v2_[a-z_]+$/), z.number().int().nonnegative()),
}).strict();

/** 仅供已停写的发布流程使用；来源须与已通过恢复演练的副本一致，持有全程迁移锁。 */
export async function runCutover(source: DataSource, rawInput: unknown, backupSha256: string) {
  const input = cutoverInputSchema.parse(rawInput);
  z.string().regex(/^[a-f0-9]{64}$/).parse(backupSha256);
  const runner = source.createQueryRunner(); await runner.connect();
  try {
    const locks = z.array(z.object({ acquired: z.coerce.number() })).parse(await runner.query("SELECT GET_LOCK('next_time_for_sure:migration',10) acquired"));
    if (locks[0]?.acquired !== 1) throw new Error('MIGRATION_LOCK_UNAVAILABLE');
    const metadata = z.array(z.object({ metadata_key: z.string(), metadata_value: z.string() })).parse(await runner.query('SELECT metadata_key,metadata_value FROM platform_metadata'));
    const values = new Map(metadata.map((row) => [row.metadata_key, row.metadata_value]));
    if (values.has('v2_retirement_ready')) {
      // 已开始的 DDL 只能在同一来源、备份及未变动目标下恢复，不能重新转换缺失的旧表。
      if (values.get('v2_retirement_ready') !== input.sourceHash || values.get('v2_retirement_backup') !== backupSha256) throw new Error('CUTOVER_MATERIAL_CHANGED');
      if (values.get('v2_conversion_target') !== await conversionTargetHash(source.manager)) throw new Error('TARGET_CHANGED_AFTER_CONVERSION');
    } else {
      if (conversionSourceHash(await readSource(source.manager), input.decisions) !== input.sourceHash) throw new Error('SOURCE_DIFFERS_FROM_REHEARSAL');
      const conversion = await convertLegacy(source, input.decisions);
      if (!conversion.repeated) assert.deepEqual(conversion.counts, input.counts);
      assert.equal((await convertLegacy(source, input.decisions)).repeated, true);
      await prepareRetirement(source, input.decisions, backupSha256);
    }

    // 数量与关键关联回读在删除来源前完成；普通 API 不提供此操作。
    for (const [table, expected] of Object.entries(input.counts)) {
      const rows = z.array(z.object({ count: z.coerce.number() })).parse(await runner.query(`SELECT COUNT(*) count FROM ${table}`));
      assert.equal(rows[0]?.count, expected, table);
    }
    const missing = z.array(z.unknown()).parse(await runner.query("SELECT t.id FROM v2_tasks t WHERE t.kind='project' AND NOT EXISTS(SELECT 1 FROM v2_arrangements a WHERE a.task_id=t.id)"));
    assert.equal(missing.length, 0);
    const applied = (await source.runMigrations()).map((row) => row.name);
    const baseline = z.array(z.object({ metadata_value: z.literal('v2') })).parse(await runner.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key='schema_baseline'"));
    assert.equal(baseline.length, 1);
    return { sourceHash: input.sourceHash, backupSha256, counts: input.counts, applied };
  } finally {
    await runner.query("SELECT RELEASE_LOCK('next_time_for_sure:migration')");
    await runner.release();
  }
}
