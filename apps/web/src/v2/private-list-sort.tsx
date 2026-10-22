import { useRef } from 'react';
import { usePointerSort } from './drag';

/** 私人弹窗内的草稿排序，复用指针跟随及键盘交互，保存时才提交整个清单。 */
export function usePrivateListSort(ids: string[], onChange: (ids: string[]) => void, disabled: boolean) {
  const root = useRef<HTMLDivElement>(null), scope = 'private-list';
  function move(id: string, beforeId: string | null) {
    if (disabled) return;
    const remaining = ids.filter((value) => value !== id), index = beforeId === null ? remaining.length : remaining.indexOf(beforeId);
    if (index < 0 || !ids.includes(id) || id === beforeId) return;
    remaining.splice(index, 0, id); onChange(remaining);
  }
  const drag = usePointerSort({ root, move: (id, _scope, target) => move(id, target.beforeId) });
  function handle(id: string, title: string) {
    return <button className="v2-sort-handle" disabled={disabled} aria-label={`拖动排序：${title}；也可用上下方向键`} onPointerDown={(event) => drag.start(event, id, scope)} onKeyDown={(event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const index = ids.indexOf(id);
      if (event.key === 'ArrowUp' && index > 0) move(id, ids[index - 1] ?? null);
      if (event.key === 'ArrowDown' && index < ids.length - 1) move(id, ids[index + 2] ?? null);
    }}>⠿</button>;
  }
  return { root, handle, listProps: { 'data-sort-scope': scope } };
}
