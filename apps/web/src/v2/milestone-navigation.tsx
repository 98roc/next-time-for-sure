import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ModalProvider } from './modal';
import { MilestoneOverview } from './milestones';
import { MilestoneModeControl } from './milestone-mode';
import { MilestoneIcon } from './milestone-parts';
import { useWorkspace } from './workspace';

const Navigation = createContext<((source?: 'report') => void) | null>(null);

/** 总览拥有独立 URL 和页面；来源组件及弹窗暂停展示，返回后沿用原筛选、文字和滚动位置。 */
export function MilestonePageSwitch({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate(), { data } = useWorkspace();
  const root = useRef<HTMLDivElement>(null), scroll = useRef({ source: 0, overview: 0 });
  const params = new URLSearchParams(location.search), overview = params.get('view') === 'milestones';
  const report = params.get('milestoneSource') === 'report';
  params.delete('milestoneSource');
  if (overview) params.delete('view');
  const sourceSearch = params.toString(), sourceKey = `${location.pathname}?${sourceSearch}`;
  const label = location.pathname === '/weekly-plans' ? report ? '周报文字版' : '周报与周计划' : '项目汇总';

  useLayoutEffect(() => {
    const main = root.current?.closest('main');
    if (!main) return;
    main.scrollTop = overview ? scroll.current.overview : scroll.current.source;
    const remember = () => { scroll.current[overview ? 'overview' : 'source'] = main.scrollTop; };
    main.addEventListener('scroll', remember);
    return () => main.removeEventListener('scroll', remember);
  }, [overview]);

  function open(source?: 'report') {
    const next = new URLSearchParams(location.search);
    next.set('view', 'milestones');
    if (source === 'report') next.set('milestoneSource', 'report'); else next.delete('milestoneSource');
    void navigate({ pathname: location.pathname, search: next.toString() }, { state: { milestoneEntry: true } });
  }
  function back() {
    const state: unknown = location.state;
    if (typeof state === 'object' && state !== null && 'milestoneEntry' in state && state.milestoneEntry === true) void navigate(-1);
    else void navigate({ pathname: location.pathname, search: sourceSearch }, { replace: true });
  }
  return <Navigation.Provider value={open}><div ref={root} className="v2-route-source" hidden={overview}>
    <ModalProvider key={sourceKey} suspended={overview}>{children}</ModalProvider>
  </div>{overview && <ModalProvider><section className="v2-ms-page" aria-label="里程碑总览">
    <button type="button" className="nt-link v2-ms-return" onClick={back}>← 返回{label}</button>
    <header className="v2-ms-page-heading"><h2>里程碑总览</h2><div className="v2-ms-page-actions"><time dateTime={data.today}><MilestoneIcon name="calendar-date" />今天 {data.today.replaceAll('-', ' / ')}</time><MilestoneModeControl /></div></header>
    <MilestoneOverview />
  </section></ModalProvider>}</Navigation.Provider>;
}

/** 所有来源统一进入当前业务区域的总览页面，禁止各入口重新创建总览弹窗。 */
export function useMilestoneNavigation() {
  const open = useContext(Navigation);
  if (!open) throw new Error('缺少里程碑页面导航上下文');
  return open;
}
