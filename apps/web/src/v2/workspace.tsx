import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Identity, V2Workspace } from '@ntfs/contracts';
import { v2IdSchema } from '@ntfs/contracts';
import { readWorkspace, sendCommand, type Commands } from './api';
import { IdentityApiError } from '../identity/api';
import { Link, matchPath, useLocation } from 'react-router-dom';

type WorkspaceContext = { data: V2Workspace; user: Identity; selectTeam: (teamId: string) => void; notify: (message: string) => void; run: <K extends keyof Commands>(path: K, body: Commands[K]) => Promise<{ objectIds: string[] }> };
const Workspace = createContext<WorkspaceContext | null>(null);

/** 全部页面共享服务器快照；轮询失败保留已加载画面，但明确提示并阻止无反馈写入。 */
export function WorkspaceProvider({ user, children }: { user: Identity; children: ReactNode }) {
  const client = useQueryClient();
  const location = useLocation();
  // 详情以地址中的团队为唯一范围；浏览器工作台偏好不能覆盖直达或刷新。
  const routeTeamId = matchPath('/organization/:teamId', location.pathname)?.params.teamId;
  const teamPreferenceKey = `ntfs.selected-team.${user.id}`;
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(() => {
    if (!user.isSuperAdmin) return undefined;
    try { const stored = v2IdSchema.safeParse(localStorage.getItem(teamPreferenceKey)); return stored.success ? stored.data : undefined; } catch { return undefined; }
  });
  const effectiveTeamId = routeTeamId ?? (user.isSuperAdmin ? selectedTeamId : undefined);
  const query = useQuery({ queryKey: ['v2', 'workspace', user.id, user.isSuperAdmin, effectiveTeamId], queryFn: () => readWorkspace(effectiveTeamId), refetchInterval: 10000, refetchOnWindowFocus: true });
  const [message, setMessage] = useState('');
  const pendingCommands = useRef(new Map<string, string>());
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (query.error instanceof IdentityApiError && [401, 403].includes(query.error.status)) void client.invalidateQueries({ queryKey: ['identity'] }); }, [query.error, client]);
  useEffect(() => {
    // 团队删除后清掉失效选择，让服务按创建顺序选择当前首个团队。
    if (!routeTeamId && selectedTeamId && query.error instanceof IdentityApiError && query.error.status === 404) {
      setSelectedTeamId(undefined);
      try { localStorage.removeItem(teamPreferenceKey); } catch { /* 存储不可用不影响本次恢复。 */ }
    }
  }, [query.error, routeTeamId, selectedTeamId, teamPreferenceKey]);
  function selectTeam(teamId: string) {
    if (!user.isSuperAdmin || !query.data?.teams?.some((team) => team.id === teamId)) return;
    setSelectedTeamId(teamId);
    try { localStorage.setItem(teamPreferenceKey, teamId); } catch { setMessage('团队已切换，但当前环境无法记住选择。'); }
  }
  if (!query.data || (routeTeamId && query.error instanceof IdentityApiError && [400, 403, 404].includes(query.error.status))) return <div className="v2-loading" role={query.isError ? 'alert' : 'status'}>{query.isError ? <>{query.error.message}<button onClick={() => { void query.refetch(); }}>重试</button>{routeTeamId && <Link to={user.isSuperAdmin ? '/organization' : '/personal'}>{user.isSuperAdmin ? '返回团队列表' : '返回我的工作'}</Link>}</> : '正在读取工作空间…'}</div>;

  /** 写入完成统一刷新跨入口数据；编辑草稿由表单保留，不随刷新重置。 */
  async function run<K extends keyof Commands>(path: K, body: Commands[K]) {
    const { operationId, ...payload } = body;
    const key = JSON.stringify({ path, payload });
    const stableId = pendingCommands.current.get(key) ?? operationId;
    pendingCommands.current.set(key, stableId);
    try {
      const result = await sendCommand(path, { ...body, operationId: stableId }, user.csrfToken, query.data?.team?.id);
      pendingCommands.current.delete(key);
      await client.invalidateQueries({ queryKey: ['v2'] });
      setMessage('已保存'); return result;
    } catch (error) {
      if (error instanceof IdentityApiError && error.status < 500) pendingCommands.current.delete(key);
      if (error instanceof IdentityApiError && [401, 403].includes(error.status)) await client.invalidateQueries({ queryKey: ['identity'] });
      throw error;
    }
  }
  return <Workspace.Provider value={{ data: query.data, user, selectTeam, notify: setMessage, run }}>{query.isError && <div className="v2-error" role="alert">数据更新失败：{query.error.message}<button onClick={() => { void query.refetch(); }}>重试</button></div>}{children}{message && <div className="v2-toast" role="status">{message}</div>}</Workspace.Provider>;
}

/** 仅在已认证工作区内调用，避免每页重复身份与加载逻辑。 */
export function useWorkspace(): WorkspaceContext { const context = useContext(Workspace); if (!context) throw new Error('工作区尚未初始化'); return context; }
