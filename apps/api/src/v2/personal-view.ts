import type { V2Category, V2Status } from '@ntfs/contracts';

export type V2Placement = { taskId: string; categoryId: string; position: number; priority: number };

/** 每个状态必须有且仅有一个默认分类；校验覆盖未显示的分类。 */
export function validateCategories(categories: V2Category[], ownerId: string): void {
  if (categories.some((category) => category.ownerId !== ownerId)) throw new Error('不能操作其他人的分类');
  if (new Set(categories.map((category) => category.id)).size !== categories.length) throw new Error('分类标识重复');
  if (new Set(categories.map((category) => category.name.trim().toLocaleLowerCase('zh-CN'))).size !== categories.length) throw new Error('分类名称不能重复');
  for (const status of ['not_started', 'in_progress', 'completed']) {
    if (categories.filter((category) => category.status === status && category.isDefault).length !== 1) throw new Error('每种状态必须有且仅有一个默认分类');
  }
}

/** 状态未变保留位置；自动流转进入默认列；明确选择分类始终优先。 */
export function destinationCategory(categories: V2Category[], status: V2Status, previous: V2Placement | undefined, previousStatus: V2Status | undefined, selected?: string): string {
  const target = selected ? categories.find((category) => category.id === selected && category.status === status) : previous && previousStatus === status ? categories.find((category) => category.id === previous.categoryId && category.status === status) : categories.find((category) => category.status === status && category.isDefault);
  if (!target) throw new Error('目标分类不存在或状态不匹配');
  return target.id;
}

/** 删除分类只移动视图，同状态接收分类继承默认职责，不改任务业务状态。 */
export function removeCategory(categories: V2Category[], sourceId: string, receiverId: string): V2Category[] {
  const source = categories.find((category) => category.id === sourceId);
  const receiver = categories.find((category) => category.id === receiverId);
  if (!source || !receiver || source.id === receiver.id || source.ownerId !== receiver.ownerId || source.status !== receiver.status) throw new Error('请选择同状态的其他接收分类，不能删除最后一个分类');
  const result = categories.filter((category) => category.id !== sourceId).map((category) => category.id === receiver.id && source.isDefault ? { ...category, isDefault: true, version: category.version + 1 } : category);
  validateCategories(result, source.ownerId);
  return result;
}
