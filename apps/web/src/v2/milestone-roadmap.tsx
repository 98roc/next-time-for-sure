import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { V2MilestoneMode } from '@ntfs/contracts';

type Stage = { top: number; bottom: number; right: number; x: number; y: number };
type Route = { width: number; height: number; path: string; arrows: string };

/** 根据实际排版连接日期节点；折返位于卡片外侧，圆角半径受可用间距约束。 */
function measureRoute(root: HTMLDivElement, mode: V2MilestoneMode): Route {
  const bounds = root.getBoundingClientRect();
  const rows: Stage[][] = [];
  for (const element of root.querySelectorAll('[data-milestone-stage]')) {
    const node = element.querySelector('[data-milestone-node]');
    if (!node) continue;
    const box = element.getBoundingClientRect(), point = node.getBoundingClientRect();
    const stage = { top: box.top - bounds.top, bottom: box.bottom - bounds.top, right: box.right - bounds.left, x: point.left + point.width / 2 - bounds.left, y: point.top + point.height / 2 - bounds.top };
    const last = rows.at(-1);
    if (last && Math.abs((last[0]?.top ?? 0) - stage.top) < 2) last.push(stage); else rows.push([stage]);
  }
  const first = rows[0]?.[0], last = rows.at(-1)?.at(-1);
  if (!first || !last || bounds.width === 0) return { width: 0, height: 0, path: '', arrows: '' };

  // 单列窄屏改用左侧竖线，避免绕着每张卡片来回折返。
  const singleColumn = getComputedStyle(root).gridTemplateColumns.trim().split(/\s+/u).length === 1;
  if (mode === 'wrap' && singleColumn) return { width: bounds.width, height: bounds.height, path: `M ${first.x} ${first.y} V ${last.y}`, arrows: '' };
  let path = '', arrows = '';
  rows.forEach((row, index) => {
    const start = row[0], end = row.at(-1), next = rows[index + 1]?.[0];
    if (!start || !end) return;
    if (!next) { path += ` M ${start.x} ${start.y} H ${end.right}`; return; }

    // 每行最深的同日卡片决定折返高度，长标题、异步刷新及多目标均不会被线穿过。
    const right = bounds.width - 4, left = 5, bottom = Math.max(...row.map((stage) => stage.bottom)) + 28;
    const radius = Math.max(0, Math.min(12, (bottom - start.y) / 2, (next.y - bottom) / 2, (next.x - left) / 2));
    path += ` M ${start.x} ${start.y} H ${right - radius} Q ${right} ${start.y} ${right} ${start.y + radius} V ${bottom - radius} Q ${right} ${bottom} ${right - radius} ${bottom} H ${left + radius} Q ${left} ${bottom} ${left} ${bottom + radius} V ${next.y - radius} Q ${left} ${next.y} ${left + radius} ${next.y} H ${next.x}`;
    arrows += ` M ${next.x - 10} ${next.y - 4} l 5 4 l -5 4`;
  });
  return { width: bounds.width, height: bounds.height, path, arrows };
}

/** 同日目标保留纵排；响应容器变化重测连线，卸载时回收观察器和动画帧。 */
export function MilestoneRoadmap({ mode, children }: { mode: V2MilestoneMode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState<Route>({ width: 0, height: 0, path: '', arrows: '' });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    const measure = () => { const next = measureRoute(element, mode); setRoute((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(element);
    element.querySelectorAll('[data-milestone-stage]').forEach((stage) => observer.observe(stage));
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [mode, children]);
  return <div className={`v2-ms-scroll${mode === 'horizontal' ? ' is-horizontal' : ''}`} role={mode === 'horizontal' ? 'region' : undefined} aria-label={mode === 'horizontal' ? '横向时间轴，可横向滚动' : undefined} tabIndex={mode === 'horizontal' ? 0 : undefined}>
    <div ref={root} className={`v2-ms-roadmap v2-ms-roadmap-${mode}`}>
      {route.width > 0 && <svg className="v2-ms-route" aria-hidden="true" viewBox={`0 0 ${route.width} ${route.height}`}><path d={route.path} /><path d={route.arrows} /></svg>}
      {children}
    </div>
  </div>;
}
