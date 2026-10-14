import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { currentIdentity } from '../identity/api';
import { NotificationIndicator } from '../lifecycle/notification-indicator';

/** 品牌标志沿用已确认原型中的错位方块。 */
export function Brand() {
  return <span className="app-brand"><span className="app-mark" aria-hidden="true" /><span><strong>下次一定</strong><small>NEXT TIME, FOR SURE</small></span></span>;
}

/** 业务页面共享导航和身份入口；首次改密完成前不开放工作区。 */
export function AppShell() {
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const location = useLocation();
  if (identity.isPending) return <div className="app-loading" role="status">正在打开工作空间…</div>;
  if (identity.isError) return <div className="app-loading" role="alert">暂时无法连接服务。<button onClick={() => { void identity.refetch(); }}>重试</button></div>;
  if (!identity.data || identity.data.mustChangePassword) return <Navigate to={`/account?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  const admin = identity.data.isSuperAdmin;
  if (admin && location.pathname !== '/organization') return <Navigate to="/organization" replace />;
  return <div className="app-shell"><aside className="app-sidebar"><NavLink to={admin ? '/organization' : '/personal'} className="brand-link" aria-label={admin ? '下次一定，返回团队管理' : '下次一定，返回我的工作'}><Brand /></NavLink>
    <nav aria-label="工作空间">{!admin && <><NavLink to="/personal">我的工作</NavLink><NavLink to="/work">项目</NavLink><NavLink to="/collaboration">通知</NavLink><span className="nav-caption">团队协作</span><NavLink to="/weekly-plans">周计划</NavLink><NavLink to="/reports">周报</NavLink></>}<NavLink to="/organization">团队管理</NavLink></nav>
    <NavLink to="/account" className="app-account"><span className="avatar">{identity.data.displayName.slice(0, 1)}</span><span>{identity.data.displayName}<small>账号与安全</small></span></NavLink>
  </aside><div className="app-body"><div className="app-topbar"><span>工作空间</span><NotificationIndicator /></div><Outlet /></div></div>;
}
