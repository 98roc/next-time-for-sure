import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 将恢复顺序收进低频操作菜单；作用范围保留在菜单文字中，支持 Escape 和外部点击关闭。 */
export function OrderMenu({ label, scope, disabled, onReset }: { label: string; scope: string; disabled: boolean; onReset: () => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function fit() {
      const element = popover.current;
      if (!element) return;
      element.style.translate = '';
      const bounds = element.getBoundingClientRect();
      const offset = bounds.left < 12 ? 12 - bounds.left : bounds.right > window.innerWidth - 12 ? window.innerWidth - 12 - bounds.right : 0;
      element.style.translate = `${offset}px 0`;
    }
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function outside(event: globalThis.PointerEvent) { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="v2-order-menu" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="v2-more" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
    {open && <div ref={popover} className="v2-order-popover"><button type="button" disabled={disabled} onClick={() => { onReset(); setOpen(false); trigger.current?.focus(); }}>恢复默认排序<small>{scope}</small></button></div>}
  </div>;
}
