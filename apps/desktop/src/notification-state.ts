/** 系统通知仅接收必要字段，业务正文不能指定外部跳转地址。 */
export interface DesktopNotice { id: string; eventId: string; title: string; path: string; readAt: string | null }

/** 拒绝损坏响应及外部URL，返回内容仍需以当前身份执行权限校验。 */
export function parseNotices(value: unknown): DesktopNotice[] {
  if (!Array.isArray(value)) throw new Error('Invalid notifications');
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string' || !('eventId' in item) || typeof item.eventId !== 'string' || !('title' in item) || typeof item.title !== 'string' || !('path' in item) || typeof item.path !== 'string' || !('readAt' in item) || (item.readAt !== null && typeof item.readAt !== 'string')) throw new Error('Invalid notification');
    if (!/^\/(?!\/)[a-zA-Z0-9/?=&_-]*$/.test(item.path)) throw new Error('Invalid notification target');
    return { id: item.id, eventId: item.eventId, title: item.title, path: item.path, readAt: item.readAt };
  });
}

/** 跨启动保存展示标识，不保存通知正文、会话或Token。 */
export class NotificationLedger {
  private readonly shown = new Set<string>();
  constructor(saved: unknown) {
    if (!Array.isArray(saved) || !saved.every((key: unknown) => typeof key === 'string')) throw new Error('Invalid notification ledger');
    for (const key of saved) this.shown.add(key);
  }
  /** 多端已读不再弹出；不同账号的事件互不影响。 */
  candidates(accountId: string, notices: DesktopNotice[]): DesktopNotice[] {
    return notices.filter((notice) => notice.readAt === null && !this.shown.has(`${accountId}:${notice.eventId}`));
  }
  /** 仅在系统确认展示后记录；展示不调用业务已读接口。 */
  record(accountId: string, eventId: string): void { this.shown.add(`${accountId}:${eventId}`); }
  /** 序列化只含账号和事件标识。 */
  serialize(): string { return JSON.stringify([...this.shown]); }
}
