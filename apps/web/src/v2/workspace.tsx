import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Identity, V2Workspace } from '@ntfs/contracts';
import { readWorkspace, sendCommand, type Commands } from './api';
import { IdentityApiError } from '../identity/api';

type WorkspaceContext = { data: V2Workspace; user: Identity; notify: (message: string) => void; run: <K extends keyof Commands>(path: K, body: Commands[K]) => Promise<{ objectIds: string[] }> };
const Workspace = createContext<WorkspaceContext | null>(null);

/** 全部页面共享服务器快照；轮询失败保留已加载画面，但明确提示并阻止无反馈写入。 */
export function WorkspaceProvider({ user, children }: { user: Identity; children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['v2', 'workspace', user.id], queryFn: readWorkspace, refetchInterval: 10000, refetchOnWindowFocus: true });
  const [message, setMessage] = useState('');
  const pendingCommands = useRef(new Map<string, string>());
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { if (query.error instanceof IdentityApiError && [401, 403].includes(query.error.status)) void client.invalidateQueries({ queryKey: ['identity'] }); }, [query.error, client]);
  if (!query.data) return <div className="v2-loading" role={query.isError ? 'alert' : 'status'}>{query.isError ? <>{query.error.message}<button onClick={() => { void query.refetch(); }}>重试</button></> : '正在读取工作空间…'}</div>;

  /** 写入完成统一刷新跨入口数据；编辑草稿由表单保留，不随刷新重置。 */
  async function run<K extends keyof Commands>(path: K, body: Commands[K]) {
    const { operationId, ...payload } = body;
    const key = JSON.stringify({ path, payload });
    const stableId = pendingCommands.current.get(key) ?? operationId;
    pendingCommands.current.set(key, stableId);
    try {
      const result = await sendCommand(path, { ...body, operationId: stableId }, user.csrfToken);
      pendingCommands.current.delete(key);
      await client.invalidateQueries({ queryKey: ['v2'] });
      setMessage('已保存'); return result;
    } catch (error) {
      if (error instanceof IdentityApiError && error.status < 500) pendingCommands.current.delete(key);
      if (error instanceof IdentityApiError && [401, 403].includes(error.status)) await client.invalidateQueries({ queryKey: ['identity'] });
      throw error;
    }
  }
  return <Workspace.Provider value={{ data: query.data, user, notify: setMessage, run }}>{query.isError && <div className="v2-error" role="alert">数据更新失败：{query.error.message}<button onClick={() => { void query.refetch(); }}>重试</button></div>}{children}{message && <div className="v2-toast" role="status">{message}</div>}</Workspace.Provider>;
}

/** 仅在已认证工作区内调用，避免每页重复身份与加载逻辑。 */
export function useWorkspace(): WorkspaceContext { const context = useContext(Workspace); if (!context) throw new Error('工作区尚未初始化'); return context; }
