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
import './shell.css';

const navigation = [
  { to: '/personal', label: '我的工作' },
  { to: '/weekly-plans', label: '周报与周计划' },
  { to: '/work', label: '项目' },
  { to: '/organization', label: '团队管理' },
];

/** 四个业务入口共用外层布局和身份行为，页面内部保留各自业务版式。 */
export function V2Shell({ user }: { user: Identity }) { return <WorkspaceProvider user={user}><Frame /></WorkspaceProvider>; }

/** 根容器包住模态层以共享原型变量，业务数据由同一个工作区提供。 */
function Frame() {
  const path = useLocation().pathname;
  const variant = path === '/personal' ? 'personal' : path === '/weekly-plans' ? 'weekly' : 'project';
  const id = variant === 'personal' ? 'ntfs-my-work' : variant === 'weekly' ? 'ntfs-weekly-demo' : 'nt-project';
  const pageClass = variant === 'weekly' ? 'w-app' : variant === 'project' ? 'nt-app' : '';
  const pageLabel = navigation.find((link) => link.to === path)?.label ?? '工作空间';
  return <div id={id} className="v2-scope"><NavigationGuard><ModalProvider>
    <div className="v2-frame">
      <Sidebar />
      <div className="v2-body">
        <div className="v2-topbar">工作空间 / {pageLabel}</div>
        <main key={path} className="v2-main" aria-label={pageLabel}>
          <div className={`v2-page ${pageClass}`}><Outlet /></div>
        </main>
      </div>
    </div>
  </ModalProvider></NavigationGuard></div>;
}

/** 四个入口顺序与原型一致，团队管理权限不足时保留原因说明。 */
function Sidebar() {
  const { user, data } = useWorkspace();
  return <aside className="v2-sidebar">
    <div className="v2-brand"><span className="v2-mark" aria-hidden="true" /><span>下次一定<small>团队协作工作台</small></span></div>
    <nav aria-label="主导航">{navigation.map((link, index) => {
      const className = (active: boolean) => `v2-nav-item${active ? ' is-current' : ''}`;
      const content = <><NavigationIcon index={index} />{link.label}</>;
      return link.to === '/organization' && !data.teamLeader ? <span key={link.to} className={className(false)} aria-disabled="true" tabIndex={0} title="团队配置由团队负责人维护，请联系团队负责人">{content}</span> : <NavLink key={link.to} to={link.to} className={({ isActive }) => className(isActive)}>{content}</NavLink>;
    })}</nav>
    <NavLink to="/account" className="v2-account" aria-label={`${user.displayName}，账号与安全`}><span className="v2-avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span><span className="v2-account-info"><span title={user.displayName}>{user.displayName}</span><small>{data.teamLeader ? '团队负责人' : '账号与安全'}</small></span></NavLink>
  </aside>;
}

/** 导航沿用原型的线性图标，不依赖不同系统的字形符号。 */
function NavigationIcon({ index }: { index: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{index === 0 ? <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></> : index === 1 ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01" /></> : index === 2 ? <><path d="m6 14 1.5-4h14l-3 10H3V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2" /></> : <><circle cx="9" cy="8" r="4" /><path d="M17 4a4 4 0 0 1 0 8M3 21v-2a6 6 0 0 1 12 0v2M21 21v-2a6 6 0 0 0-4-5.65" /></>}</svg>;
}
