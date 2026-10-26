import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

/** 短确认统一使用原生模态弹窗；取消、关闭与 Escape 均保留原草稿并恢复触发焦点。 */
export function ConfirmDialog({ title, children, confirmLabel, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), label = useId(), description = useId();
  useEffect(() => {
    const element = dialog.current, priorFocus = document.activeElement;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (priorFocus instanceof HTMLElement && priorFocus.isConnected) priorFocus.focus();
    };
  }, []);

  return <dialog ref={dialog} className="v2-dialog v2-compact v2-confirm-dialog" role="alertdialog" aria-labelledby={label} aria-describedby={description} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons[0], last = buttons[buttons.length - 1];
    // 显式循环焦点，避免原生 Tab 边界把焦点交给浏览器工具栏。
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={(event) => {
    // 内层 Escape 只取消确认，不能继续冒泡触发原表单的退出保护。
    event.preventDefault(); event.stopPropagation(); onCancel();
  }}>
    <div className="v2-dialog-layout">
      <header className="v2-dialog-header"><h2 id={label}>{title}</h2><button type="button" className="v2-close" aria-label="关闭" onClick={onCancel}>×</button></header>
      <div className="v2-content" id={description}>{children}</div>
      <footer className="v2-dialog-footer"><div className="v2-actions v2-footer-actions"><button ref={cancel} type="button" onClick={onCancel}>取消</button><button type="button" className="v2-danger" onClick={onConfirm}>{confirmLabel}</button></div></footer>
    </div>
  </dialog>;
}
