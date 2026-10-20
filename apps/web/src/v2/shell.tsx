import { useState } from 'react';
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
import './sorting.css';

const navigation = [
  { to: '/personal', label: '我的工作' },
  { to: '/weekly-plans', label: '周报与周计划' },
  { to: '/work', label: '项目' },
  { to: '/organization', label: '团队管理' },
];

const sidebarPreferenceKey = 'ntfs.sidebar-collapsed';

/** 本机、当前站点的界面偏好；存储不可用时仍允许本次展开和收起。 */
function useSidebarPreference() {
  const { notify } = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(sidebarPreferenceKey) === 'true'; }
    catch { return false; }
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(sidebarPreferenceKey, String(next)); }
    catch { notify('侧栏已切换，但当前环境无法记住状态。'); }
  }

  return { collapsed, toggle };
}

/** 四个业务入口共用外层布局和身份行为，页面内部保留各自业务版式。 */
export function V2Shell({ user }: { user: Identity }) { return <WorkspaceProvider user={user}><Frame /></WorkspaceProvider>; }

/** 根容器包住模态层以共享原型变量，业务数据由同一个工作区提供。 */
function Frame() {
  const { collapsed, toggle } = useSidebarPreference();
  const path = useLocation().pathname;
  const variant = path === '/personal' ? 'personal' : path === '/weekly-plans' ? 'weekly' : 'project';
  const id = variant === 'personal' ? 'ntfs-my-work' : variant === 'weekly' ? 'ntfs-weekly-demo' : 'nt-project';
  const pageClass = variant === 'weekly' ? 'w-app' : variant === 'project' ? 'nt-app' : '';
  const pageLabel = navigation.find((link) => link.to === path)?.label ?? '工作空间';
  return <div id={id} className="v2-scope"><NavigationGuard><ModalProvider>
    <div className={`v2-frame${collapsed ? ' is-sidebar-collapsed' : ''}`}>
      <Sidebar />
      <div className="v2-body">
        <div className="v2-topbar">
          <button type="button" className="v2-sidebar-toggle" aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} title={collapsed ? '展开侧边栏' : '收起侧边栏'} aria-expanded={!collapsed} aria-controls="v2-sidebar" onClick={toggle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg>
          </button>
          <span>工作空间 / {pageLabel}</span>
        </div>
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
  return <aside id="v2-sidebar" className="v2-sidebar">
    <div className="v2-brand" aria-label="下次一定" title="下次一定"><span className="v2-mark" aria-hidden="true" /><span className="v2-brand-text">下次一定<small>团队协作工作台</small></span></div>
    <nav aria-label="主导航">{navigation.map((link, index) => {
      const className = (active: boolean) => `v2-nav-item${active ? ' is-current' : ''}`;
      const content = <><NavigationIcon index={index} /><span className="v2-nav-label">{link.label}</span></>;
      return link.to === '/organization' && !data.teamLeader ? <span key={link.to} className={className(false)} aria-label={`${link.label}：团队配置由团队负责人维护，请联系团队负责人`} aria-disabled="true" tabIndex={0} title="团队配置由团队负责人维护，请联系团队负责人">{content}</span> : <NavLink key={link.to} to={link.to} aria-label={link.label} title={link.label} className={({ isActive }) => className(isActive)}>{content}</NavLink>;
    })}</nav>
    <NavLink to="/account" className="v2-account" title={`${user.displayName}，账号与安全`} aria-label={`${user.displayName}，账号与安全`}><span className="v2-avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span><span className="v2-account-info"><span title={user.displayName}>{user.displayName}</span><small>{data.teamLeader ? '团队负责人' : '账号与安全'}</small></span></NavLink>
  </aside>;
}

/** 导航沿用原型的线性图标，不依赖不同系统的字形符号。 */
function NavigationIcon({ index }: { index: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{index === 0 ? <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></> : index === 1 ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01" /></> : index === 2 ? <><path d="m6 14 1.5-4h14l-3 10H3V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2" /></> : <><circle cx="9" cy="8" r="4" /><path d="M17 4a4 4 0 0 1 0 8M3 21v-2a6 6 0 0 1 12 0v2M21 21v-2a6 6 0 0 0-4-5.65" /></>}</svg>;
}
