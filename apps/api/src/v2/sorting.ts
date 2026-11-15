/** 任务默认优先级升序、创建时间升序；同毫秒按标识稳定排序，缺失历史排后。 */
export function compareTaskOrder(a: { id: string; priority: number | null; createdAt: string | null }, b: { id: string; priority: number | null; createdAt: string | null }): number {
  return (a.priority ?? 3) - (b.priority ?? 3) || (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999') || a.id.localeCompare(b.id);
}

/** 合并完整列表的新对象并保留已保存的顺序。追加时将倒序的新对象转为正序。 */
export function resolveOrder(defaultIds: string[], stored: string[] | null, newestIds = defaultIds, insertNewAt: 'start' | 'end' = 'start'): string[] {
  if (stored === null) return [...defaultIds];
  const current = new Set(defaultIds), known = new Set(stored);
  const added = newestIds.filter((id) => current.has(id) && !known.has(id));
  const retained = stored.filter((id) => current.has(id));
  return insertNewAt === 'end' ? [...retained, ...added.reverse()] : [...added, ...retained];
}

/** 连续新增尚未刷新时也按最新创建在前，避免优先级打乱置顶语义。 */
export function newestTaskIds(rows: { id: string; createdAt: string | null }[]): string[] {
  return [...rows].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id)).map((row) => row.id);
}
