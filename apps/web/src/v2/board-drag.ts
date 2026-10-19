import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PointerEvent, RefObject } from 'react';

export type BoardDrop = { kind: 'task' | 'category'; id: string; scope: string; beforeId: string | null };
type Session = { cancel: (render?: boolean) => void };
const easing = 'cubic-bezier(.2,.8,.2,1)';

/** 看板指针交互：动画与命中分离，逐帧只更新浮层；有效放下才提交一次业务变更。 */
export function useBoardDrag(root: RefObject<HTMLDivElement | null>, drop: (destination: BoardDrop) => void, disabled: boolean, version: number) {
  const session = useRef<Session | null>(null), landing = useRef<(() => void) | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => () => { session.current?.cancel(false); landing.current?.(); }, []);
  // 外部状态同步使当前落点失效时取消拖动，不提交开始时捕获的旧版本。
  useEffect(() => { session.current?.cancel(); }, [version]);

  function start(event: PointerEvent<HTMLElement>, kind: BoardDrop['kind'], id: string) {
    if (disabled || session.current || event.button !== 0 || !event.isPrimary) return;
    const rootElement = root.current, origin = event.target;
    if (!rootElement || !(origin instanceof HTMLElement)) return;
    const board = rootElement;
    // 按钮保留点击行为；任务标题允许鼠标拖动，触屏保留滑动阅读，顶部手柄负责触屏拖动。
    if (origin.closest('button:not(.mw-title):not(.mw-category-handle),select,input,summary,a,details')) return;
    if (event.pointerType === 'touch' && kind === 'task' && !origin.closest('.mw-task-top')) return;
    const selector = kind === 'task' ? '[data-task-id]' : '[data-category-id]';
    const sourceElement = origin.closest<HTMLElement>(selector);
    if (!sourceElement) return;
    const source = sourceElement;
    const shellElement = board.closest<HTMLElement>('.v2-scope');
    if (!shellElement) return;
    const shell = shellElement;
    landing.current?.();
    const scrollArea = board.closest<HTMLElement>('.v2-main');
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    const rect = source.getBoundingClientRect();
    const originalScope = source.closest<HTMLElement>('[data-task-scope]')?.dataset.taskScope ?? 'categories';
    let x = startX, y = startY, started = false, frame = 0, lastTime = 0;
    let locatedX = Number.NaN, locatedY = Number.NaN, scrollLeft = board.scrollLeft, scrollTop = scrollArea?.scrollTop ?? 0;
    let ghost: HTMLElement | null = null, placeholder: HTMLElement | null = null, target: BoardDrop | null = null;
    const animations = new Map<HTMLElement, Animation>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elements = () => Array.from(board.querySelectorAll<HTMLElement>(selector)).filter((item) => item !== source);
    const horizontal = () => kind === 'category' && getComputedStyle(board).display !== 'grid';

    /** 命中使用布局坐标，抵消让位动画，避免卡片在指针下反复交换。 */
    function bounds(element: HTMLElement) {
      const box = element.getBoundingClientRect(), transform = getComputedStyle(element).transform;
      const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
      return { left: box.left - (matrix?.m41 ?? 0), top: box.top - (matrix?.m42 ?? 0), width: box.width, height: box.height };
    }
    function sameTarget(next: BoardDrop | null) { return target?.scope === next?.scope && target?.beforeId === next?.beforeId; }

    /** 占位只在落点变化时移动，保留原始节点；React 不承担逐帧指针坐标更新。 */
    function positionPlaceholder(parent: HTMLElement, before: HTMLElement | null) {
      if (!placeholder) return;
      const items = elements(), previous = new Map(items.map((item) => [item, item.getBoundingClientRect()]));
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      parent.insertBefore(placeholder, before);
      if (kind === 'task') placeholder.style.width = '';
      if (reduced) return;
      for (const item of items) {
        const prior = previous.get(item), next = item.getBoundingClientRect();
        if (!prior) continue;
        const dx = prior.left - next.left, dy = prior.top - next.top;
        if (Math.abs(dx) + Math.abs(dy) < 1) continue;
        animations.set(item, item.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 180, easing }));
      }
    }

    function locate() {
      if (!placeholder) return;
      const hit = document.elementFromPoint(x, y);
      const viewport = scrollArea?.getBoundingClientRect();
      if (!hit || !board.contains(hit) || (viewport && (y < viewport.top || y > viewport.bottom))) { target = null; board.removeAttribute('data-drop-scope'); return; }
      const parent = kind === 'category' ? board : hit.closest<HTMLElement>('[data-task-scope]')?.querySelector<HTMLElement>('.mw-card-list');
      if (!parent) { target = null; board.removeAttribute('data-drop-scope'); return; }
      const scope = kind === 'category' ? 'categories' : parent.closest<HTMLElement>('[data-task-scope]')?.dataset.taskScope;
      if (!scope) return;
      const gap = placeholder.getBoundingClientRect();
      // 停在占位内部时保持落点，不用动画中的邻居重新计算。
      if (placeholder.parentElement === parent && x >= gap.left && x <= gap.right && y >= gap.top && y <= gap.bottom) {
        target = { kind, id, scope, beforeId: placeholder.dataset.beforeId || null }; board.dataset.dropScope = scope; return;
      }
      const cards = elements().filter((item) => item.parentElement === parent);
      const before = cards.find((item) => { const box = bounds(item); return horizontal() ? x < box.left + box.width / 2 : y < box.top + box.height / 2; }) ?? null;
      const beforeId = before?.getAttribute(kind === 'task' ? 'data-task-id' : 'data-category-id') ?? null;
      const next = { kind, id, scope, beforeId };
      if (!sameTarget(next)) { placeholder.dataset.beforeId = beforeId ?? ''; positionPlaceholder(parent, before); }
      target = next; board.dataset.dropScope = scope;
    }

    function speed(point: number, low: number, high: number) {
      const edge = Math.min(64, (high - low) / 4);
      if (point < low || point > high) return 0;
      return point < low + edge ? -800 * (1 - (point - low) / edge) : point > high - edge ? 800 * (1 - (high - point) / edge) : 0;
    }
    function tick(time: number) {
      if (!started) return;
      const elapsed = lastTime ? Math.min(32, time - lastTime) / 1000 : 0; lastTime = time;
      const box = board.getBoundingClientRect(), viewport = scrollArea?.getBoundingClientRect();
      // 速度按时间计算，高刷新率屏幕不会滚得更快；仅指针仍在看板范围内时滚动。
      if (x >= box.left && x <= box.right && y >= Math.max(box.top, viewport?.top ?? 0) && y <= Math.min(box.bottom, viewport?.bottom ?? window.innerHeight)) {
        board.scrollLeft += speed(x, box.left, box.right) * elapsed;
        scrollArea?.scrollBy(0, speed(y, viewport?.top ?? 0, viewport?.bottom ?? window.innerHeight) * elapsed);
      }
      const nextScrollTop = scrollArea?.scrollTop ?? 0;
      if (x !== locatedX || y !== locatedY || board.scrollLeft !== scrollLeft || nextScrollTop !== scrollTop) {
        locate(); locatedX = x; locatedY = y; scrollLeft = board.scrollLeft; scrollTop = nextScrollTop;
      }
      if (ghost) ghost.style.transform = `translate3d(${x - startX + rect.left}px,${y - startY + rect.top}px,0)`;
      frame = requestAnimationFrame(tick);
    }

    function begin() {
      const clone = source.cloneNode(true);
      if (!(clone instanceof HTMLElement) || !source.parentElement) return;
      ghost = clone; ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach((item) => item.removeAttribute('id'));
      ghost.classList.add('v2-drag-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, transform: `translate3d(${rect.left}px,${rect.top}px,0)`, transformOrigin: 'top left' });
      shell.append(ghost);
      placeholder = document.createElement('div'); placeholder.className = kind === 'task' ? 'mw-placeholder' : 'mw-column mw-category-placeholder';
      placeholder.setAttribute('aria-hidden', 'true'); placeholder.style.height = `${rect.height}px`;
      const nextSibling = source.nextElementSibling;
      placeholder.dataset.beforeId = nextSibling?.getAttribute(kind === 'task' ? 'data-task-id' : 'data-category-id') ?? '';
      source.before(placeholder); source.classList.add('v2-drag-source');
      target = { kind, id, scope: originalScope, beforeId: placeholder.dataset.beforeId || null };
      board.dataset.dragKind = kind; started = true; setActive(true);
      // 捕获在不会被隐藏的容器上，避免触屏隐式捕获随原卡片隐藏而丢失。
      board.setPointerCapture(pointerId); document.getSelection()?.removeAllRanges();
      frame = requestAnimationFrame(tick);
    }
    function pointerMove(next: globalThis.PointerEvent) {
      if (next.pointerId !== pointerId) return;
      x = next.clientX; y = next.clientY;
      if (!started && Math.hypot(x - startX, y - startY) < 5) return;
      next.preventDefault(); if (!started) begin();
    }
    function suppressClick(next: MouseEvent) { next.preventDefault(); next.stopPropagation(); }
    function finish(commit: boolean, render = true) {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel);
      board.removeEventListener('lostpointercapture', cancelPointer);
      if (board.hasPointerCapture(pointerId)) board.releasePointerCapture(pointerId);
      for (const animation of animations.values()) animation.cancel();
      placeholder?.remove(); source.classList.remove('v2-drag-source');
      delete board.dataset.dragKind; delete board.dataset.dropScope; session.current = null;
      if (!started) return;
      if (!render) { ghost?.remove(); return; }
      // 放下当帧展示最终位置，后端失败由调用方回滚，避免等待网络时闪回旧位置。
      if (commit && target) flushSync(() => { setActive(false); if (target) drop(target); });
      else setActive(false);
      const destination = Array.from(board.querySelectorAll<HTMLElement>(selector)).find((item) => item.getAttribute(kind === 'task' ? 'data-task-id' : 'data-category-id') === id);
      const landingRect = destination?.getBoundingClientRect(), floating = ghost;
      document.addEventListener('click', suppressClick, { capture: true, once: true });
      const clickTimer = setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
      const clean = () => { clearTimeout(clickTimer); document.removeEventListener('click', suppressClick, true); floating?.remove(); landing.current = null; };
      landing.current = clean;
      if (!floating || !landingRect || reduced) { setTimeout(clean, 0); return; }
      const animation = floating.animate([{ transform: floating.style.transform, opacity: .96 }, { transform: `translate3d(${landingRect.left}px,${landingRect.top}px,0) scale(${landingRect.width / rect.width},${landingRect.height / rect.height})`, opacity: 0 }], { duration: 160, easing });
      animation.onfinish = clean;
    }
    function release(next: globalThis.PointerEvent) { if (next.pointerId === pointerId) { x = next.clientX; y = next.clientY; if (started) locate(); finish(true); } }
    function cancel() { finish(false); }
    function cancelPointer(next: globalThis.PointerEvent) { if (next.pointerId === pointerId) cancel(); }
    function escape(next: KeyboardEvent) { if (next.key === 'Escape') { next.preventDefault(); cancel(); } }
    document.addEventListener('pointermove', pointerMove, { passive: false }); document.addEventListener('pointerup', release); document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('keydown', escape); window.addEventListener('blur', cancel); board.addEventListener('lostpointercapture', cancelPointer);
    session.current = { cancel: (render = true) => finish(false, render) };
  }
  return { start, active };
}
