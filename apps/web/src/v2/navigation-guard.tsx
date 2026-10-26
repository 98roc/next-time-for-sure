import { createContext, useContext, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from './confirm-dialog';

const GuardContext = createContext<((id: string, dirty: boolean) => void) | null>(null);

/** 表单和周报共用离开保护；浏览器后退、应用导航和刷新均不得静默丢失输入。 */
export function NavigationGuard({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, boolean>>({});
  const dirty = Object.values(entries).some(Boolean);
  const blocker = useBlocker(dirty);
  const [register] = useState(() => (id: string, value: boolean) => {
    setEntries((previous) => {
      if (Boolean(previous[id]) === value) return previous;
      const next = { ...previous };
      if (value) next[id] = true; else delete next[id];
      return next;
    });
  });
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  return <GuardContext.Provider value={register}>{children}{blocker.state === 'blocked' && <ConfirmDialog title="离开当前页面" confirmLabel="确认离开" onCancel={() => blocker.reset()} onConfirm={() => blocker.proceed()}><p>有未保存的修改，离开后将丢失。</p></ConfirmDialog>}</GuardContext.Provider>;
}

/** 每个编辑器独立登记，卸载时只清理自己的保护状态。 */
export function useNavigationGuard(dirty: boolean) {
  const register = useContext(GuardContext), id = useId();
  useEffect(() => { register?.(id, dirty); return () => register?.(id, false); }, [register, id, dirty]);
}
