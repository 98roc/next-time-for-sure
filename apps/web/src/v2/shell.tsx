import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Identity } from '@ntfs/contracts';
import { WorkspaceProvider, useWorkspace } from './workspace';
import { ModalProvider } from './modal';
import { NavigationGuard } from './navigation-guard';
import './base.css';
import './my-work.css';
import './project.css';
import './weekly.css';
import './components.css';
import './adaptations.css';

/** 三套原型保留各自布局，导航和身份行为共用，不复制认证逻辑。 */
export function V2Shell({ user }: { user: Identity }) { return <WorkspaceProvider user={user}><Frame /></WorkspaceProvider>; }

/** 根容器包住模态层以共享原型变量，业务数据由同一个工作区提供。 */
function Frame() {
  const path = useLocation().pathname;
  const variant = path === '/personal' ? 'personal' : path === '/weekly-plans' ? 'weekly' : 'project';
  const id = variant === 'personal' ? 'ntfs-my-work' : variant === 'weekly' ? 'ntfs-weekly-demo' : 'nt-project';
  return <div id={id} className="v2-scope"><NavigationGuard><ModalProvider>
    {variant === 'personal' ? <div className="mw-shell"><Sidebar variant={variant} /><main className="mw-main"><Outlet /></main></div> : variant === 'weekly' ? <div className="w-app"><div className="w-shell"><Sidebar variant={variant} /><div className="w-body"><div className="w-topbar">工作空间 / 周报与周计划</div><main className="w-main"><Outlet /></main></div></div></div> : <div className="nt-app"><header className="nt-top"><span className="v2-mark" /><span className="nt-brand">下次一定</span><span className="nt-caption">研发工作空间</span></header><div className="nt-shell"><Sidebar variant={variant} /><main className="nt-main"><Outlet /></main></div></div>}
  </ModalProvider></NavigationGuard></div>;
}

/** 四个入口顺序与原型一致，团队管理权限不足时保留原因说明。 */
function Sidebar({ variant }: { variant: 'personal' | 'weekly' | 'project' }) {
  const { user, data } = useWorkspace();
  const links = [{ to: '/personal', label: '我的工作' }, { to: '/weekly-plans', label: '周报与周计划' }, { to: '/work', label: '项目' }, { to: '/organization', label: '团队管理' }];
  const aside = variant === 'personal' ? 'mw-nav' : variant === 'weekly' ? 'w-side' : 'nt-nav';
  return <aside className={aside}>
    {variant !== 'project' && <div className={variant === 'personal' ? 'mw-brand' : 'w-brand'}><span className="v2-mark" /><span>下次一定{variant === 'personal' && <small>团队协作工作台</small>}</span></div>}
    <nav aria-label="主导航">{links.map((link, index) => {
      const className = (active: boolean) => variant === 'personal' ? `mw-nav-item ${active ? 'active' : ''}` : variant === 'weekly' ? `w-nav ${active ? 'is-current' : ''}` : active ? 'nt-active' : '';
      const content = <>{variant !== 'project' && <NavigationIcon index={index} />}{link.label}</>;
      return link.to === '/organization' && !data.teamLeader ? <span key={link.to} className={className(false)} aria-disabled="true" tabIndex={0} title="团队配置由团队负责人维护，请联系团队负责人">{content}</span> : <NavLink key={link.to} to={link.to} className={({ isActive }) => className(isActive)}>{content}</NavLink>;
    })}</nav>
    <NavLink to="/account" className={variant === 'personal' ? 'mw-profile' : variant === 'weekly' ? 'w-account' : 'v2-profile'}><span className="v2-avatar">{user.displayName.slice(0, 1)}</span><span>{user.displayName}<small>{data.teamLeader ? '团队负责人' : '账号与安全'}</small></span></NavLink>
  </aside>;
}

/** 导航沿用原型的线性图标，不依赖不同系统的字形符号。 */
function NavigationIcon({ index }: { index: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{index === 0 ? <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></> : index === 1 ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01" /></> : index === 2 ? <><path d="m6 14 1.5-4h14l-3 10H3V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2" /></> : <><circle cx="9" cy="8" r="4" /><path d="M17 4a4 4 0 0 1 0 8M3 21v-2a6 6 0 0 1 12 0v2M21 21v-2a6 6 0 0 0-4-5.65" /></>}</svg>;
}
