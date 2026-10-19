import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';

type Target = { scope: string; beforeId: string | null };
type Drag = { id: string; scope: string; target: Target | null; height: number };

/** 指针拖动共享引擎：只识别容器内已标记对象，取消时完全不提交。 */
export function usePointerSort({ root, allowCrossScope, move }: { root: RefObject<HTMLElement | null>; allowCrossScope: boolean; move: (id: string, from: string, target: Target) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const positions = useRef(new Map<HTMLElement, DOMRect>());
  useLayoutEffect(() => {
    const next = new Map<HTMLElement, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>('[data-sort-id]:not(.v2-drag-ghost):not(.v2-drag-source)').forEach((element) => {
      const rect = element.getBoundingClientRect(), before = positions.current.get(element);
      if (drag && before && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const x = before.left - rect.left, y = before.top - rect.top;
        if (x || y) element.animate([{ transform: 'translate(' + x + 'px,' + y + 'px)' }, { transform: 'translate(0,0)' }], { duration: 140, easing: 'ease-out' });
      }
      next.set(element, rect);
    });
    positions.current = next;
  }, [drag, root]);

  function start(event: PointerEvent<HTMLElement>, id: string, scope: string) {
    if (event.button !== 0 || cleanup.current) return;
    const candidate = event.currentTarget.closest('[data-sort-id]');
    const container = root.current;
    if (!(candidate instanceof HTMLElement) || !container) return;
    const source = candidate;
    const scrollArea = container.closest<HTMLElement>('.v2-main');
    const initial = { x: event.clientX, y: event.clientY }, rect = source.getBoundingClientRect();
    let x = initial.x, y = initial.y, begun = false, ghost: HTMLElement | null = null, target: Target | null = null, frame = 0;
    const cancel = () => finish(false);
    const escape = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); finish(false); } };
    function locate() {
      let hit = document.elementFromPoint(x, y)?.closest('[data-sort-scope]');
      while (hit instanceof HTMLElement && !allowCrossScope && hit.dataset.sortScope !== scope) hit = hit.parentElement?.closest('[data-sort-scope]');
      if (!(hit instanceof HTMLElement) || !container?.contains(hit)) { target = null; return; }
      const nextScope = hit.dataset.sortScope;
      if (!nextScope || (!allowCrossScope && nextScope !== scope)) { target = null; return; }
      const cards = Array.from(hit.querySelectorAll<HTMLElement>('[data-sort-id]')).filter((card) => card.dataset.sortId !== id && card.closest('[data-sort-scope]') === hit && !card.closest('.v2-drag-ghost'));
      const before = cards.find((card) => y < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
      target = { scope: nextScope, beforeId: before?.dataset.sortId ?? null };
    }
    function tick() {
      if (!begun || !container) return;
      const bounds = container.getBoundingClientRect(), edge = 55;
      if (x > bounds.right - edge) container.scrollLeft += 14; else if (x < bounds.left + edge) container.scrollLeft -= 14;
      // 工作区独立滚动后，边缘拖动必须跟随内容视口，不能再滚动整个窗口。
      const viewport = scrollArea?.getBoundingClientRect();
      const delta = y > (viewport?.bottom ?? window.innerHeight) - edge ? 14 : y < (viewport?.top ?? 0) + edge ? -14 : 0;
      if (scrollArea) scrollArea.scrollBy(0, delta); else window.scrollBy(0, delta);
      locate(); setDrag((previous) => previous?.id === id && previous.target?.scope === target?.scope && previous.target?.beforeId === target?.beforeId ? previous : { id, scope, target, height: rect.height });
      frame = requestAnimationFrame(tick);
    }
    function pointerMove(next: globalThis.PointerEvent) {
      if (next.pointerId !== event.pointerId) return;
      x = next.clientX; y = next.clientY;
      if (!begun && Math.hypot(x - initial.x, y - initial.y) < 6) return;
      next.preventDefault();
      if (!begun) {
        begun = true; const clone = source.cloneNode(true);
        if (clone instanceof HTMLElement) { ghost = clone; ghost.removeAttribute('id'); ghost.classList.add('v2-drag-ghost'); ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; ghost.setAttribute('aria-hidden', 'true'); container?.append(ghost); }
        source.classList.add('v2-drag-source'); frame = requestAnimationFrame(tick);
      }
      if (ghost) ghost.style.transform = `translate(${x - (initial.x - rect.left)}px,${y - (initial.y - rect.top)}px)`;
    }
    function finish(commit: boolean) {
      cancelAnimationFrame(frame); document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel);
      ghost?.remove(); source.classList.remove('v2-drag-source'); cleanup.current = null; setDrag(null);
      if (commit && begun && target) move(id, scope, target);
    }
    function release(next: globalThis.PointerEvent) { if (next.pointerId === event.pointerId) { x = next.clientX; y = next.clientY; if (begun) locate(); finish(true); } }
    document.addEventListener('pointermove', pointerMove, { passive: false }); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    cleanup.current = cancel;
  }
  return { drag, start };
}
