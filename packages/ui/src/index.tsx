import type { PropsWithChildren } from 'react';

/** 用于工程状态的非交互标记，不充当业务任务状态。 */
export function StatusBadge({ tone, children }: PropsWithChildren<{ tone: 'success' | 'warning' | 'neutral' }>) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
