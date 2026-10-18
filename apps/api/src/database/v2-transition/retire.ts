import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { conversionSourceHash, conversionTargetHash, convertLegacy } from './convert.js';
import { migrationDecisionsSchema, readSource } from './source.js';

/** 显式登记已验证的切换材料；调用方须停止写入并提供真实备份摘要，不能用于普通接口。 */
export async function prepareRetirement(source: DataSource, decisions: unknown, backupSha256: string): Promise<void> {
  z.string().regex(/^[a-f0-9]{64}$/).parse(backupSha256);
  const conversion = await convertLegacy(source, decisions);
  if (!conversion.repeated) throw new Error('VERIFY_CONVERSION_BEFORE_RETIREMENT');
  await source.transaction(async (db) => {
    await db.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key='schema_baseline' FOR UPDATE");
    if (conversion.sourceHash !== conversionSourceHash(await readSource(db), migrationDecisionsSchema.parse(decisions))) throw new Error('SOURCE_CHANGED_AFTER_CONVERSION');
    const targets = z.array(z.object({ metadata_value: z.string() })).parse(await db.query("SELECT metadata_value FROM platform_metadata WHERE metadata_key='v2_conversion_target'"));
    if (targets[0]?.metadata_value !== await conversionTargetHash(db)) throw new Error('TARGET_CHANGED_AFTER_CONVERSION');
    for (const [key, value] of [['v2_retirement_ready', conversion.sourceHash], ['v2_retirement_backup', backupSha256]]) await db.query('INSERT INTO platform_metadata(metadata_key,metadata_value,created_at) VALUES (?,?,UTC_TIMESTAMP(3))', [key, value]);
  });
}
