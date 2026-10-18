import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { personalStatusLabels, personalStatusSchema } from './legacy-contracts.js';

/** 旧分类按原执行状态拆列，迁移只改归类，不重写状态或实际时间。 */
export class PersonalWorkflow1792022401000 implements MigrationInterface {
  name = 'PersonalWorkflow1792022401000';
  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasColumn('personal_categories', 'status'))) await runner.query("ALTER TABLE personal_categories ADD status VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT '分类对应执行状态：未开始、进行中、已完成', MODIFY name VARCHAR(200) NOT NULL COMMENT '用户自定义分类名称，执行阶段由状态字段决定'");
    await runner.startTransaction();
    try {
      await runner.query("SELECT metadata_key FROM platform_metadata WHERE metadata_key='schema_baseline' FOR UPDATE");
      const categories = z.array(z.object({ id: z.string(), owner_id: z.string(), name: z.string() })).parse(await runner.query('SELECT id, owner_id, name FROM personal_categories'));
      for (const category of categories) {
        const states = z.array(z.object({ status: personalStatusSchema })).parse(await runner.query('SELECT DISTINCT status FROM personal_items WHERE category_id=? ORDER BY status', [category.id]));
        const first = states.find((entry) => entry.status === 'not_started') ?? states[0];
        await runner.query('UPDATE personal_categories SET status=?, version=version+1 WHERE id=?', [first?.status ?? 'not_started', category.id]);
        for (const state of states.filter((entry) => entry.status !== first?.status)) {
          const id = randomUUID();
          await runner.query('INSERT INTO personal_categories (id, owner_id, name, status) VALUES (?, ?, ?, ?)', [id, category.owner_id, `${category.name.slice(0, 190)} · ${personalStatusLabels[state.status]}`, state.status]);
          await runner.query('UPDATE personal_items SET category_id=?, version=version+1 WHERE category_id=? AND status=?', [id, category.id, state.status]);
        }
      }
      const accounts = z.array(z.object({ id: z.string() })).parse(await runner.query('SELECT id FROM accounts'));
      for (const account of accounts) for (const status of personalStatusSchema.options) {
        const existing = z.array(z.object({ id: z.string() })).parse(await runner.query('SELECT id FROM personal_categories WHERE owner_id=? AND status=? ORDER BY id LIMIT 1', [account.id, status]));
        const id = existing[0]?.id ?? randomUUID();
        if (!existing.length) await runner.query('INSERT INTO personal_categories (id, owner_id, name, status) VALUES (?, ?, ?, ?)', [id, account.id, personalStatusLabels[status], status]);
        await runner.query('UPDATE personal_items SET category_id=?, version=version+1 WHERE owner_id=? AND category_id IS NULL AND status=?', [id, account.id, status]);
      }
      await runner.commitTransaction();
    } catch (error) { await runner.rollbackTransaction(); throw error; }
  }
  /** 状态分类不可通过回滚抹去用户后续归类，修复采用前向迁移。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
