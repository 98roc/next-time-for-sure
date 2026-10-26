import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createOperationId } from '../identity/operation-id';
import { useNavigationGuard } from './navigation-guard';

type Page = { key: string; content: ReactNode };
type Flow = { open: (content: ReactNode) => void; push: (content: ReactNode) => void; back: () => void; close: (force?: boolean) => void; finishPage: (key: string) => void; canBack: boolean; dirty: (key: string, value: boolean, busy: boolean) => void };
const FlowContext = createContext<Flow | null>(null);
const PageContext = createContext({ key: '', active: false });

/** 单个原生模态层保留返回栈与草稿，所有确认均在同层切换。 */
export function ModalProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [pending, setPending] = useState<'close' | 'back' | null>(null);
  const dirty = useRef(new Map<string, boolean>());
  const locked = useRef(new Map<string, boolean>());
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<Element | null>(null);
  const pageFocus = useRef(new Map<string, HTMLElement>());
  const active = pages.at(-1)?.key;
  const opened = pages.length > 0;
  useEffect(() => {
    if (!opened) return;
    priorFocus.current = document.activeElement;
    const element = dialog.current, overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = overflow; if (priorFocus.current instanceof HTMLElement && priorFocus.current.isConnected) priorFocus.current.focus(); };
  }, [opened]);
  useEffect(() => {
    const page = dialog.current?.querySelector('[data-active="true"]');
    // 排期入口明确指定日期焦点，优先于原生 dialog 打开时自动聚焦的返回按钮。
    const preferred = page?.querySelector('[data-v2-autofocus]:not(:disabled)');
    if (preferred instanceof HTMLElement) { preferred.focus(); return; }
    const remembered = active ? pageFocus.current.get(active) : undefined;
    if (remembered?.isConnected && page?.contains(remembered) && !remembered.matches(':disabled')) { remembered.focus(); return; }
    const field = page?.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[data-v2-back],button');
    if (field instanceof HTMLElement) field.focus();
  }, [active]);

  function navigate(action: 'back' | 'close', force = false) {
    if (!force && pages.some((page) => locked.current.get(page.key))) return;
    const unsaved = action === 'close' ? pages.some((page) => dirty.current.get(page.key)) : active && dirty.current.get(active);
    if (unsaved && !force) { setPending(action); return; }
    setPending(null);
    if (action === 'close') { dirty.current.clear(); locked.current.clear(); pageFocus.current.clear(); setPages([]); }
    else { if (active) { dirty.current.delete(active); locked.current.delete(active); pageFocus.current.delete(active); } setPages((previous) => previous.slice(0, -1)); }
  }
  const flow: Flow = {
    open: (content) => { if (pages.length) throw new Error('请在当前弹窗内继续操作'); dirty.current.clear(); setPages([{ key: createOperationId(), content }]); },
    push: (content) => { setPending(null); setPages((previous) => [...previous, { key: createOperationId(), content }]); },
    back: () => navigate('back'), close: (force) => navigate('close', force), canBack: pages.length > 1,
    finishPage: (key) => { setPending(null); setPages((previous) => { const index = previous.findIndex((page) => page.key === key); for (const page of previous.slice(index)) { dirty.current.delete(page.key); locked.current.delete(page.key); pageFocus.current.delete(page.key); } return index < 0 ? previous : previous.slice(0, index); }); },
    dirty: (key, value, busy) => { dirty.current.set(key, value); locked.current.set(key, busy); },
  };
  return <FlowContext.Provider value={flow}>{children}{opened && <dialog ref={dialog} className="v2-dialog" aria-label="工作操作" onFocusCapture={(event) => { if (active && event.target instanceof HTMLElement && event.target.closest('[data-active="true"]')) pageFocus.current.set(active, event.target); }} onCancel={(event) => { event.preventDefault(); navigate(pages.length > 1 ? 'back' : 'close'); }}>
    {pending && <div className="v2-unsaved" role="alert"><span>有未保存的修改。</span><button onClick={() => setPending(null)}>继续编辑</button><button className="v2-danger" onClick={() => navigate(pending, true)}>放弃修改并{pending === 'back' ? '返回' : '关闭'}</button></div>}
    {pages.map((page) => <div key={page.key} hidden={page.key !== active} data-active={page.key === active}><PageContext.Provider value={{ key: page.key, active: page.key === active }}>{page.content}</PageContext.Provider></div>)}
  </dialog>}</FlowContext.Provider>;
}

/** 可复用的表单视图，标题和底栏固定，滚动只发生于内容区。 */
export function ModalPage({ title, children, actions, dirty = false, busy = false, wide = false, compact = false, subtitle, hideCloseAction = false, onClose, className = '', closeLabel = '×', footerNote }: { title: string; subtitle?: string; compact?: boolean; hideCloseAction?: boolean; children: ReactNode; actions?: ReactNode; dirty?: boolean; busy?: boolean; wide?: boolean; onClose?: () => void; className?: string; closeLabel?: string; footerNote?: ReactNode }) {
  useNavigationGuard(dirty || busy);
  const flow = useModal(), page = useContext(PageContext), label = useId(), root = useRef<HTMLDivElement>(null);
  useEffect(() => { flow.dirty(page.key, dirty, busy); }, [flow, page.key, dirty, busy]);
  useEffect(() => { if (page.active) root.current?.closest('dialog')?.classList.toggle('v2-wide', wide); }, [page.active, wide]);
  useEffect(() => { if (page.active) root.current?.closest('dialog')?.classList.toggle('v2-compact', compact); }, [page.active, compact]);
  return <div ref={root} className={`v2-dialog-layout ${className}`} aria-labelledby={label}>
    <header className="v2-dialog-header">{flow.canBack && <button data-v2-back disabled={busy} onClick={flow.back}>← 返回</button>}<h2 id={label}>{title}{subtitle && <span className="v2-dialog-subtitle">{subtitle}</span>}</h2><button className="v2-close" aria-label="关闭" disabled={busy} onClick={onClose ?? (() => flow.close())}>{closeLabel}</button></header>
    <div className="v2-content">{children}</div>{(!hideCloseAction || actions) && <footer className="v2-dialog-footer">{footerNote}<div className="v2-actions v2-footer-actions">{!hideCloseAction && <button disabled={busy} onClick={() => flow.close()}>关闭</button>}{actions}</div></footer>}
  </div>;
}

/** 页面只持有操作内容，所有层级复用同一遮罩与焦点边界。 */
export function useModal() { const flow = useContext(FlowContext), page = useContext(PageContext); if (!flow) throw new Error('缺少弹窗上下文'); return { ...flow, finish: () => flow.finishPage(page.key) }; }
