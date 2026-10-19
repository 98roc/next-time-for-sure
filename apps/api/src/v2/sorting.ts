/** 任务默认优先级升序、创建时间升序；同毫秒按标识稳定排序，缺失历史排后。 */
export function compareTaskOrder(a: { id: string; priority: number | null; createdAt: string | null }, b: { id: string; priority: number | null; createdAt: string | null }): number {
  return (a.priority ?? 3) - (b.priority ?? 3) || (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999') || a.id.localeCompare(b.id);
}

/** 手动列表新增对象置顶，旧对象保持相对顺序；调用者必须传完整业务作用域。 */
export function resolveOrder(defaultIds: string[], stored: string[] | null, newestIds = defaultIds): string[] {
  if (stored === null) return [...defaultIds];
  const current = new Set(defaultIds), known = new Set(stored);
  return [...newestIds.filter((id) => current.has(id) && !known.has(id)), ...stored.filter((id) => current.has(id))];
}

/** 连续新增尚未刷新时也按最新创建在前，避免优先级打乱置顶语义。 */
export function newestTaskIds(rows: { id: string; createdAt: string | null }[]): string[] {
  return [...rows].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.id.localeCompare(b.id)).map((row) => row.id);
}
