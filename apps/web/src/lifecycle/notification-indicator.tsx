import { useQuery } from '@tanstack/react-query';
import { notificationsSchema } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { reportingRequest } from '../weekly-plans/reporting-api';
import { Link } from 'react-router-dom';

/** 页面轮询只更新站内消息，不将弹出或展示当成已读。 */
export function NotificationIndicator() {
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const notices = useQuery({ queryKey: ['notifications', identity.data?.id], queryFn: async () => notificationsSchema.parse(await reportingRequest('notifications')), enabled: Boolean(identity.data && !identity.data.mustChangePassword && !identity.data.isSuperAdmin), refetchInterval: 10000, retry: false });
  if (!identity.data || identity.data.mustChangePassword || identity.data.isSuperAdmin) return null;
  const unread = notices.data?.filter((entry) => !entry.readAt).length ?? 0;
  return <aside className="notification-indicator"><Link to="/collaboration" aria-label={notices.error ? '通知同步失败，打开通知重试' : unread ? `通知，${unread} 条未读` : '通知，暂无未读'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span>通知</span>{unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}{notices.error && <span>同步失败</span>}</Link></aside>;
}
