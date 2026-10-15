import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/** 原生模态层约束键盘焦点；关闭后恢复触发入口，忙碌时阻止误关闭。 */
export function Dialog({ title, children, onClose, busy = false, drawer = false, className = '', headerActions }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; drawer?: boolean; className?: string; headerActions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const dialog = ref.current;
    const priorOverflow = document.body.style.overflow;
    dialog?.showModal();
    // 折叠区中的字段不可聚焦，优先选取当前实际可见且可输入的控件。
    const initial = Array.from(dialog?.querySelectorAll('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? []).find((element) => element.getClientRects().length > 0);
    if (initial instanceof HTMLElement) initial.focus();
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = priorOverflow; };
  }, []);
  return <dialog ref={ref} className={`app-dialog org-layout ${drawer ? 'app-drawer' : ''} ${className}`} aria-labelledby={label} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-header"><h2 id={label}>{title}</h2>{headerActions}<button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
