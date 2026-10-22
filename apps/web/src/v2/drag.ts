import { useEffect, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';

type Target = { scope: string; beforeId: string | null };

/** 同列表指针排序：保留原布局，用位移预览顺序，命中检测不读取动画中的位置。 */
export function usePointerSort({ root, move }: { root: RefObject<HTMLElement | null>; move: (id: string, scope: string, target: Target) => void }) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  function start(event: PointerEvent<HTMLElement>, id: string, scope: string) {
    if (event.button !== 0 || cleanup.current) return;
    const source = event.currentTarget.closest<HTMLElement>('[data-sort-id]');
    const list = source?.closest<HTMLElement>('[data-sort-scope]');
    const container = root.current;
    if (!source || !list || !container || list.dataset.sortScope !== scope) return;
    event.stopPropagation();
    const scrollArea = container.closest<HTMLElement>('.v2-content, .v2-main');
    const origin = source.getBoundingClientRect(), initial = { x: event.clientX, y: event.clientY };
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-sort-id]')).filter((card) => card.closest('[data-sort-scope]') === list);
    const index = cards.indexOf(source);
    if (index < 0) return;
    const geometry = cards.map((card) => ({ card, rect: card.getBoundingClientRect(), translate: card.style.translate, transition: card.style.transition }));
    const initialScroll = scrollArea?.scrollTop ?? window.scrollY;
    let x = initial.x, y = initial.y, begun = false, ghost: HTMLElement | null = null, target: Target | null = null, frame = 0, lastTime = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 轮询或其他操作改变列表时取消旧手势，避免拿旧布局覆盖新顺序。
    const observer = new MutationObserver(() => {
      const current = Array.from(list.querySelectorAll<HTMLElement>('[data-sort-id]')).filter((card) => card.closest('[data-sort-scope]') === list);
      if (current.length !== cards.length || current.some((card, position) => card !== cards[position])) finish(false);
    });
    observer.observe(list, { childList: true, subtree: true });

    // 原行保留高度，兄弟行仅做合成位移，不插入会改变命中位置的占位块。
    function preview(destination: number) {
      const reordered = geometry.filter((_, position) => position !== index);
      const selected = geometry[index];
      if (!selected) return;
      reordered.splice(destination, 0, selected);
      let top = geometry[0]?.rect.top ?? 0;
      reordered.forEach((entry, position) => {
        if (entry.card !== source) entry.card.style.translate = `0 ${top - entry.rect.top}px`;
        const previous = geometry[position], next = geometry[position + 1];
        top += entry.rect.height + (previous && next ? next.rect.top - previous.rect.bottom : 0);
      });
    }

    function locate() {
      if (!list || !source || !container?.isConnected) return false;
      const bounds = list.getBoundingClientRect(), viewport = scrollArea?.getBoundingClientRect();
      const visibleTop = Math.max(bounds.top, viewport?.top ?? 0), visibleBottom = Math.min(bounds.bottom, viewport?.bottom ?? window.innerHeight);
      if (x < bounds.left || x > bounds.right || y < visibleTop || y > visibleBottom) {
        target = null; preview(index); return true;
      }
      const scrollDelta = (scrollArea?.scrollTop ?? window.scrollY) - initialScroll;
      const candidates = geometry.filter((entry) => entry.card !== source);
      const before = candidates.findIndex((entry) => y + scrollDelta < entry.rect.top + entry.rect.height / 2);
      const destination = before < 0 ? candidates.length : before;
      target = { scope, beforeId: candidates[destination]?.card.dataset.sortId ?? null };
      preview(destination);
      return true;
    }

    function tick(time: number) {
      if (!begun || !source?.isConnected) { finish(false); return; }
      const viewport = scrollArea?.getBoundingClientRect(), edge = 56;
      const top = viewport?.top ?? 0, bottom = viewport?.bottom ?? window.innerHeight;
      const elapsed = Math.min(lastTime ? time - lastTime : 16, 32); lastTime = time;
      // 按离边缘的距离渐进滚动，并保持不同刷新率下的速度一致。
      const withinWidth = !viewport || (x >= viewport.left && x <= viewport.right);
      const speed = !withinWidth ? 0 : y < top + edge ? -Math.min(1, (top + edge - y) / edge) : y > bottom - edge ? Math.min(1, (y - bottom + edge) / edge) : 0;
      if (scrollArea) scrollArea.scrollTop += speed * elapsed * .65;
      else window.scrollBy(0, speed * elapsed * .65);
      if (ghost) ghost.style.transform = `translate3d(${x - initial.x + origin.left}px,${y - initial.y + origin.top}px,0)`;
      if (!locate()) { finish(false); return; }
      frame = requestAnimationFrame(tick);
    }

    function pointerMove(next: globalThis.PointerEvent) {
      if (next.pointerId !== event.pointerId) return;
      x = next.clientX; y = next.clientY;
      if (!begun && Math.hypot(x - initial.x, y - initial.y) < 6) return;
      next.preventDefault();
      if (begun || !source || !container) return;
      begun = true;
      const clone = source.cloneNode(true);
      if (clone instanceof HTMLElement) {
        ghost = clone; ghost.removeAttribute('id'); ghost.removeAttribute('data-sort-id'); ghost.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
        ghost.classList.add('v2-drag-ghost'); ghost.style.width = `${origin.width}px`; ghost.style.height = `${origin.height}px`;
        ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
        // 留在页面样式作用域内，脱离滚动容器，避免浮层被裁切。
        (container.closest('.v2-dialog-layout') ?? container.closest('.v2-page') ?? container).append(ghost);
      }
      source.classList.add('v2-sort-source');
      geometry.forEach(({ card }) => { if (card !== source) card.style.transition = reduceMotion ? 'none' : 'translate 150ms ease'; });
      document.addEventListener('click', suppressClick, true);
      frame = requestAnimationFrame(tick);
    }
    function suppressClick(click: MouseEvent) { click.preventDefault(); click.stopPropagation(); }
    function finish(commit: boolean) {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel); observer.disconnect();
      ghost?.remove(); source?.classList.remove('v2-sort-source');
      geometry.forEach(({ card, translate, transition }) => { card.style.transition = transition; card.style.translate = translate; });
      cleanup.current = null;
      // pointerup 后浏览器仍会派发 click，避免拖动误触任务详情。
      window.setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
      // 使用起拖时的版本提交；期间来源变更由服务端版本校验拒绝。
      if (commit && begun && target) move(id, scope, target);
    }
    function release(next: globalThis.PointerEvent) { if (next.pointerId === event.pointerId) { x = next.clientX; y = next.clientY; if (begun) locate(); finish(true); } }
    function cancel() { finish(false); }
    function escape(key: KeyboardEvent) { if (key.key === 'Escape') { key.preventDefault(); finish(false); } }
    document.addEventListener('pointermove', pointerMove, { passive: false }); document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', escape); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    cleanup.current = cancel;
  }
  return { start };
}
