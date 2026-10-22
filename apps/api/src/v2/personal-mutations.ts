import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2PersonalCommand } from '@ntfs/contracts';
import { requireVersion, checkRule, type V2Context } from './context.js';
import { V2PersonalRepository } from './personal.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { removeCategory, validateCategories } from './personal-view.js';
import { requireConfirmation } from './impact.js';
import { requireTask } from './authorization.js';
import { mutateTask } from './task-mutations.js';

/** 本人分类与顺序统一提交，跨状态移动复用任务状态服务和历史记录。 */
export async function mutatePersonal(manager: EntityManager, context: V2Context, command: V2PersonalCommand, today: string): Promise<string[]> {
  const repository = new V2PersonalRepository(manager), ownerId = context.actor.id;
  await repository.ensure(ownerId); requireVersion(await repository.version(ownerId), command.version);
  const categories = await repository.categories(ownerId);
  if (command.action === 'reorder_priority' || command.action === 'reset_order') { await repository.resetOrder(ownerId); return [ownerId]; }
  if (command.action === 'move_category') {
    const category = categories.find((row) => row.id === command.categoryId);
    const remaining = categories.filter((row) => row.id !== command.categoryId);
    const index = command.beforeCategoryId === null ? remaining.length : remaining.findIndex((row) => row.id === command.beforeCategoryId);
    if (!category || index < 0) throw new ConflictException('分类或目标位置已变化，请刷新。');

    // 仅修改本人的列位置；分类状态、默认职责和任务顺序保持不变。
    remaining.splice(index, 0, category);
    await repository.reorderCategories(ownerId, remaining.map((row) => row.id));
    return [category.id];
  }
  if (command.action === 'move_task') {
    const task = requireTask(context, await new V2TaskRepository(manager).get(command.taskId));
    if (task.executorId !== ownerId || task.deletedAt) throw new ForbiddenException('只能整理本人当前工作。');
    requireVersion(task.version, command.taskVersion);
    const category = categories.find((row) => row.id === command.categoryId);
    if (!category) throw new ConflictException('分类不存在。');
    // 无效落点应在状态变更前发现；事务同时保护移动时发生的外部状态同步。
    if (command.beforeTaskId && !(await repository.placements(ownerId)).some((row) => row.taskId === command.beforeTaskId && row.categoryId === category.id && row.taskId !== task.id)) throw new ConflictException('目标位置已变化，请刷新。');
    if (task.status !== category.status || command.completion) await mutateTask(manager, context, { action: 'set_status', operationId: command.operationId, taskId: task.id, version: task.version, status: category.status, categoryId: category.id, ...(command.completion ? { completion: command.completion } : {}) }, task);
    await repository.place({ ...task, status: category.status }, task, category.id, command.beforeTaskId); return [task.id];
  }
  if (command.action === 'create_category') {
    const id = randomUUID();
    const updated = categories.map((row) => command.isDefault && row.status === command.status && row.isDefault ? { ...row, isDefault: false, version: row.version + 1 } : row);
    updated.push({ id, ownerId, name: command.name, status: command.status, isDefault: command.isDefault, position: categories.length, version: 0 });
    checkRule(() => validateCategories(updated, ownerId)); await repository.saveCategories(ownerId, updated); return [id];
  }
  const category = categories.find((row) => row.id === command.categoryId);
  if (!category) throw new ConflictException('分类不存在。');
  if (command.action === 'delete_category') {
    await requireConfirmation(manager, context, { action: command.action, version: command.version, categoryId: command.categoryId, receiverId: command.receiverId }, command.confirmation, today);
    const updated = checkRule(() => removeCategory(categories, command.categoryId, command.receiverId));
    // 先移动任务、删除原分类再保存唯一默认，全部在同一事务内完成。
    await repository.removeCategory(ownerId, command.categoryId, command.receiverId); await repository.saveCategories(ownerId, updated);
  } else {
    const updated = categories.map((row) => command.action === 'rename_category' ? row.id === category.id ? { ...row, name: command.name, version: row.version + 1 } : row : row.status === category.status ? { ...row, isDefault: row.id === category.id, version: row.version + 1 } : row);
    checkRule(() => validateCategories(updated, ownerId)); await repository.saveCategories(ownerId, updated);
  }
  return [category.id];
}
