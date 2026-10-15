import { Notification, session } from 'electron';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { NotificationLedger, parseNotices } from './notification-state.js';

/** 主进程轮询同一Electron会话；隐藏窗口后仍继续，显式退出时停止。 */
export async function startNotifications(origin: string, ledgerPath: string, open: (path: string) => void, businessSession: Electron.Session = session.defaultSession): Promise<() => void> {
  let saved: unknown = [];
  try { saved = JSON.parse(await readFile(ledgerPath, 'utf8')); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('无法读取通知展示记录', { cause: error });
  }
  const ledger = new NotificationLedger(saved);
  const active = new Map<string, Notification>();
  let stopped = false; let polling = false; let generation = 0; let account = '';
  let writes = Promise.resolve();
  const invalidate = () => { generation++; account = ''; for (const toast of active.values()) toast.close(); active.clear(); };
  const changed = (_event: Electron.Event, cookie: Electron.Cookie) => { if (cookie.name === 'ntfs_session') invalidate(); };
  businessSession.cookies.on('changed', changed);

  /** fetch自动使用当前分区Cookie，禁止重定向到其他服务。 */
  const get = async (path: string): Promise<unknown> => {
    const response = await businessSession.fetch(`${origin}/api/v1/${path}`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('会话或服务不可用');
    return response.json();
  };
  const identity = async () => {
    const value = await get('auth/me');
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string' || !('mustChangePassword' in value) || value.mustChangePassword !== false) throw new Error('当前身份不可用');
    return value.id;
  };
  const persist = () => {
    const data = ledger.serialize();
    writes = writes.then(async () => { await writeFile(`${ledgerPath}.tmp`, data, 'utf8'); await rename(`${ledgerPath}.tmp`, ledgerPath); }).catch(() => { console.error('无法保存系统通知去重状态。'); });
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true; const epoch = generation;
    try {
      const current = await identity();
      const notices = parseNotices(await get('notifications'));
      // 再读身份并检查Cookie变更代次，防止切换账号期间的旧响应弹出。
      const verified = await identity();
      if (stopped || epoch !== generation || current !== verified) return;
      if (account && account !== current) { invalidate(); return; }
      account = current;
      if (!Notification.isSupported()) return;
      for (const notice of ledger.candidates(current, notices).slice(0, 5)) {
        const key = `${current}:${notice.eventId}`;
        if (active.has(key)) continue;
        const toast = new Notification({ title: '下次一定', body: notice.title });
        active.set(key, toast);
        toast.once('show', () => {
          if (stopped || epoch !== generation) { toast.close(); return; }
          ledger.record(current, notice.eventId); persist();
        });
        toast.once('failed', () => active.delete(key));
        toast.once('close', () => active.delete(key));
        toast.once('click', () => { void (async () => {
          const verified = await identity();
          if (stopped || epoch !== generation || current !== verified) return;
          // 权限可能已被收回，点击前重新检查该通知仍在当前可见集合。
          const visible = parseNotices(await get('notifications'));
          if (!stopped && epoch === generation && visible.some((entry) => entry.id === notice.id)) open(notice.path);
        })().catch(() => invalidate()); });
        toast.show();
      }
    } catch { invalidate(); } finally { polling = false; }
  };
  const interval = setInterval(() => { void poll(); }, 10000);
  void poll();
  return () => { stopped = true; clearInterval(interval); businessSession.cookies.removeListener('changed', changed); invalidate(); };
}
