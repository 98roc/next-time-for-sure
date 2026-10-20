import { Notification, powerMonitor, type Session } from 'electron';

type Message = { id: string; items: { taskId: string; title: string; projectName: string; reasons: string[] }[] };
type Feed = { accountId: string; cursor: string; messages: Message[] };

/** 桌面只消费已鉴权的固定消息接口，运行时校验后才允许构造系统通知和内部链接。 */
export function parseFeed(value: unknown): Feed {
  if (!value || typeof value !== 'object' || !('accountId' in value) || typeof value.accountId !== 'string' || !('cursor' in value) || typeof value.cursor !== 'string' || !/^\d{1,20}$/u.test(value.cursor) || !('messages' in value) || !Array.isArray(value.messages)) throw new Error('消息格式无效');
  const messages: Message[] = value.messages.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || !('items' in row) || !Array.isArray(row.items)) throw new Error('消息格式无效');
    const items = row.items.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('taskId' in item) || typeof item.taskId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(item.taskId) || !('title' in item) || typeof item.title !== 'string' || !('projectName' in item) || typeof item.projectName !== 'string' || !('reasons' in item) || !Array.isArray(item.reasons)) throw new Error('消息格式无效');
      const reasons = item.reasons.map((reason: unknown) => { if (typeof reason !== 'string') throw new Error('消息格式无效'); return reason; });
      return { taskId: item.taskId, title: item.title, projectName: item.projectName, reasons };
    });
    return { id: row.id, items };
  });
  return { accountId: value.accountId, cursor: value.cursor, messages };
}

/** 主进程轮询不受隐藏窗口节流影响；首连、换号、休眠及任何网络失败均重建游标，不补弹。 */
export function startNotifications(session: Session, origin: URL, open: (path: string) => void): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = 'start', accountId = '', generation = 0, lastPoll = 0, sessionValue = '';
  const active = new Set<Notification>();
  const reset = () => { cursor = 'start'; accountId = ''; generation++; for (const notification of active) notification.close(); active.clear(); };
  const cookieChanged = (_event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean) => {
    if (cookie.name !== 'ntfs_session' || (removed && cause === 'overwrite')) return;
    const value = removed ? '' : cookie.value;
    if (value !== sessionValue) { sessionValue = value; reset(); }
  };
  session.cookies.on('changed', cookieChanged);
  powerMonitor.on('suspend', reset);
  powerMonitor.on('resume', reset);
  async function poll(): Promise<void> {
    if (stopped) return;
    if (lastPoll && Date.now() - lastPoll > 30000) reset();
    lastPoll = Date.now();
    const revision = generation, baseline = cursor === 'start';
    try {
      const response = await session.fetch(new URL(`/api/v1/v2/notifications?after=${cursor}`, origin).href, { headers: { 'X-NTFS-Session-Activity': 'passive' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('消息暂不可用');
      const feed = parseFeed(await response.json());
      if (stopped || revision !== generation) return;
      const sameAccount = accountId === feed.accountId;
      accountId = feed.accountId; cursor = feed.cursor;
      if (!baseline && sameAccount && Notification.isSupported()) {
        for (const message of feed.messages) {
          const first = message.items[0];
          if (!first) continue;
          const notification = new Notification({ title: '下次一定', body: message.items.length === 1 ? `${first.projectName} · ${first.reasons.join('；')}\n${first.title}` : `你有 ${message.items.length} 项任务消息，点击查看`, silent: false });
          active.add(notification);
          notification.on('close', () => active.delete(notification));
          notification.on('click', () => { if (!stopped && revision === generation) open(message.items.length === 1 ? `/personal?messageTask=${encodeURIComponent(first.taskId)}` : '/personal?messages=1'); });
          notification.show();
        }
      }
    } catch { reset(); }
    finally { if (!stopped) timer = setTimeout(() => { void poll(); }, 5000); }
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); session.cookies.removeListener('changed', cookieChanged); powerMonitor.removeListener('suspend', reset); powerMonitor.removeListener('resume', reset); reset(); };
}
