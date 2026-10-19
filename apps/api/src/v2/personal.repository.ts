import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { v2CategorySchema, v2PlacementSchema, v2StatusLabels, v2StatusSchema, type V2Category, type V2Task } from '@ntfs/contracts';
import { destinationCategory } from './personal-view.js';
import { checkRule } from './context.js';

/** 个人位置只影响本人看板，使用全量视图版本保护筛选外任务。 */
export class V2PersonalRepository {
  constructor(private readonly manager: EntityManager) {}

  /** 在组织锁下初始化三状态默认分类；读取不会复制业务任务。 */
  async ensure(ownerId: string): Promise<void> {
    await this.manager.query('INSERT IGNORE INTO v2_personal_views(owner_id) VALUES (?)', [ownerId]);
    const categories = await this.categories(ownerId);
    for (const [position, status] of v2StatusSchema.options.entries()) {
      if (categories.some((category) => category.status === status)) continue;
      let name = v2StatusLabels[status];
      for (let suffix = 2; categories.some((category) => category.name === name); suffix++) name = `${v2StatusLabels[status]} ${suffix}`;
      await this.manager.query('INSERT INTO v2_categories(id,owner_id,name,status,is_default,position) VALUES (?,?,?,?,1,?)', [randomUUID(), ownerId, name, status, position]);
    }
  }

  /** 只返回本人的分类，包括筛选外的列。 */
  async categories(ownerId: string): Promise<V2Category[]> {
    return z.array(v2CategorySchema.extend({ isDefault: z.union([z.number(), z.boolean()]).transform(Boolean) })).parse(await this.manager.query('SELECT id,owner_id AS ownerId,name,status,is_default AS isDefault,position,version FROM v2_categories WHERE owner_id=? ORDER BY position,id', [ownerId]));
  }

  /** 默认零仅用于尚未初始化的新账号；正常读写先执行 ensure。 */
  async version(ownerId: string): Promise<number> { return z.array(z.object({ version: z.number() })).parse(await this.manager.query('SELECT version FROM v2_personal_views WHERE owner_id=?', [ownerId]))[0]?.version ?? 0; }

  /** 私人顺序只读本人，项目权限撤销后的任务不向页面返回位置。 */
  async placements(ownerId: string) {
    const rows = z.array(v2PlacementSchema).parse(await this.manager.query(`SELECT p.task_id AS taskId,p.category_id AS categoryId,p.position FROM v2_placements p JOIN v2_categories c ON c.id=p.category_id JOIN v2_tasks t ON t.id=p.task_id WHERE p.owner_id=? ORDER BY c.position,c.id,CASE WHEN c.manual_order=1 THEN p.position ELSE t.priority END,CASE WHEN c.manual_order=0 THEN t.created_at END,p.task_id`, [ownerId]));
    return rows.map((row, position) => ({ ...row, position }));
  }

  /** 恢复后优先级和新增任务动态参与默认排序，分类和任务状态均不改变。 */
  async resetOrder(ownerId: string): Promise<void> {
    await this.manager.query('UPDATE v2_categories SET manual_order=0 WHERE owner_id=?', [ownerId]);
    await this.bump(ownerId);
  }

  /** 状态改变或转执行人后进入默认分类；默认分类按规则展示，手动分类置顶。 */
  async place(task: V2Task, previous?: V2Task, selected?: string, beforeTaskId?: string | null): Promise<void> {
    const ownerId = task.executorId;
    await this.ensure(ownerId);
    const categories = await this.categories(ownerId);
    const placements = await this.placements(ownerId);
    const prior = placements.find((row) => row.taskId === task.id);
    const categoryId = checkRule(() => destinationCategory(categories, task.status, prior ? { ...prior, priority: task.priority } : undefined, previous?.executorId === ownerId ? previous.status : undefined, selected));
    if (prior && prior.categoryId === categoryId && beforeTaskId === undefined) return;
    if (previous && previous.executorId !== ownerId) {
      await this.manager.query('DELETE FROM v2_placements WHERE task_id=?', [task.id]);
      await this.bump(previous.executorId);
    }
    const targets = placements.filter((row) => row.categoryId === categoryId && row.taskId !== task.id);
    const index = beforeTaskId === null ? targets.length : beforeTaskId === undefined ? 0 : targets.findIndex((row) => row.taskId === beforeTaskId);
    if (index < 0) throw new ConflictException('目标位置已变化，请刷新');
    targets.splice(index, 0, { taskId: task.id, categoryId, position: index });
    for (const [position, row] of targets.entries()) await this.manager.query('INSERT INTO v2_placements(task_id,owner_id,category_id,position) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),category_id=VALUES(category_id),position=VALUES(position)', [row.taskId, ownerId, categoryId, position]);
    if (beforeTaskId !== undefined) await this.manager.query('UPDATE v2_categories SET manual_order=1 WHERE id=? AND owner_id=?', [categoryId, ownerId]);
    await this.bump(ownerId);
  }

  /** 保存分类集合时先清旧默认，避免唯一键在交换期间冲突；同事务原子提交。 */
  async saveCategories(ownerId: string, categories: V2Category[]): Promise<void> {
    await this.manager.query('UPDATE v2_categories SET is_default=0 WHERE owner_id=?', [ownerId]);
    for (const category of categories) await this.manager.query('INSERT INTO v2_categories(id,owner_id,name,status,is_default,position,version) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),is_default=VALUES(is_default),position=VALUES(position),version=VALUES(version)', [category.id, ownerId, category.name, category.status, Number(category.isDefault), category.position, category.version]);
    await this.bump(ownerId);
  }

  /** 删除列前把原列全部任务移到同状态接收列末尾，隐藏任务也保留。 */
  async removeCategory(ownerId: string, sourceId: string, receiverId: string): Promise<void> {
    const rows = await this.placements(ownerId);
    const combined = [...rows.filter((row) => row.categoryId === receiverId), ...rows.filter((row) => row.categoryId === sourceId)];
    for (const [position, row] of combined.entries()) await this.manager.query('UPDATE v2_placements SET category_id=?,position=? WHERE task_id=? AND owner_id=?', [receiverId, position, row.taskId, ownerId]);
    await this.manager.query('DELETE FROM v2_categories WHERE id=? AND owner_id=?', [sourceId, ownerId]);
  }

  /** 删除业务任务解除当前位置但不删除历史，旧执行人的看板版本也要变化。 */
  async removeTask(task: V2Task): Promise<void> { await this.manager.query('DELETE FROM v2_placements WHERE task_id=?', [task.id]); await this.bump(task.executorId); }

  /** 自动状态同步与人工排序共用版本，防止覆盖并发的外部状态变化。 */
  async bump(ownerId: string): Promise<void> { await this.manager.query('UPDATE v2_personal_views SET version=version+1 WHERE owner_id=?', [ownerId]); }
}
