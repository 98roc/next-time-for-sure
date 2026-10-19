import { useRef, useState } from 'react';
import { useAction } from './controls';

/** 松手即展示新顺序；保存期间阻止重复提交，失败后撤回预览并保留明确错误。 */
export function useSortFeedback() {
  const action = useAction(), locked = useRef(false);
  const [pending, setPending] = useState<{ scope: string; ids: string[] } | null>(null);
  function ordered<T>(scope: string, rows: T[], id: (row: T) => string): T[] {
    if (pending?.scope !== scope) return rows;
    const byId = new Map(rows.map((row) => [id(row), row]));
    return [...pending.ids.flatMap((key) => { const row = byId.get(key); return row === undefined ? [] : [row]; }), ...rows.filter((row) => !pending.ids.includes(id(row)))];
  }
  function save(scope: string, ids: string[] | null, work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true;
    if (ids) setPending({ scope, ids });
    void action.act(async () => {
      try { await work(); }
      finally { setPending(null); locked.current = false; }
    });
  }
  return { busy: action.busy, error: action.error, ordered, save };
}
