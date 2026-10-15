import type { ReactNode } from 'react';

/** 空状态先说明当前情况，再给出当前角色可执行的下一步。 */
export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <section className="guided-empty"><span className="empty-symbol" aria-hidden="true">＋</span><h2>{title}</h2><p>{description}</p>{children && <div className="empty-actions">{children}</div>}</section>;
}
