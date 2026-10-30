import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { currentIdentity } from '../identity/api';
import { V2Shell } from '../v2/shell';

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
  if (!identity.data.isSuperAdmin && location.pathname === '/accounts') return <Navigate to="/personal" replace />;
  return <V2Shell user={identity.data} />;
}
