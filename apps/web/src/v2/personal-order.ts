import type { V2Workspace } from '@ntfs/contracts';
import type { BoardDrop } from './board-drag';

/** 根据明确落点投影个人顺序；使用全量位置，保留筛选外任务及其他分类的顺序。 */
export function projectPersonalOrder(data: Pick<V2Workspace, 'categories' | 'placements'>, drop: BoardDrop) {
  if (drop.kind === 'category') {
    const category = data.categories.find((row) => row.id === drop.id);
    const categories = data.categories.filter((row) => row.id !== drop.id);
    const index = drop.beforeId === null ? categories.length : categories.findIndex((row) => row.id === drop.beforeId);
    if (!category || index < 0) return data;
    categories.splice(index, 0, category);
    return { ...data, categories: categories.map((row, position) => ({ ...row, position })) };
  }
  const current = data.placements.find((row) => row.taskId === drop.id);
  if (!current || !data.categories.some((row) => row.id === drop.scope)) return data;
  const target = data.placements.filter((row) => row.categoryId === drop.scope && row.taskId !== drop.id).sort((a, b) => a.position - b.position);
  const index = drop.beforeId === null ? target.length : target.findIndex((row) => row.taskId === drop.beforeId);
  if (index < 0) return data;
  target.splice(index, 0, { ...current, categoryId: drop.scope });
  return { ...data, placements: [...data.placements.filter((row) => row.categoryId !== drop.scope && row.taskId !== drop.id), ...target.map((row, position) => ({ ...row, position }))] };
}
