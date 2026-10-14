import { useQuery } from '@tanstack/react-query';
import { notificationsSchema } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { reportingRequest } from '../weekly-plans/reporting-api';

/** 页面轮询只更新站内消息，不将弹出或展示当成已读。 */
export function NotificationIndicator() {
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const notices = useQuery({ queryKey: ['notifications', identity.data?.id], queryFn: async () => notificationsSchema.parse(await reportingRequest('notifications')), enabled: Boolean(identity.data && !identity.data.mustChangePassword), refetchInterval: 10000, retry: false });
  if (!identity.data || identity.data.mustChangePassword) return null;
  const unread = notices.data?.filter((entry) => !entry.readAt).length ?? 0;
  return <aside className="notification-indicator"><a href="/collaboration">协作总览 · {notices.error ? '通知同步失败，点击重试' : unread ? `${unread} 条未读通知` : '暂无未读通知'}</a></aside>;
}
