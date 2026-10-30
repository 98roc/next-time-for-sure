import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationCommand, OrganizationSnapshot } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { Dialog } from '../layout/dialog';
import { organizationCommand, organizationSnapshot } from './api';
import { CommandForm, actionLabels } from './command-form';
import type { EditorAction } from './command-form';
import './organization.css';

type Editor = { action: EditorAction; targetId: string | undefined; data: OrganizationSnapshot };

/** 超管专用的基础目录；团队内部项目配置统一由 V2 团队页维护。 */
export function OrganizationPage({ accounts = false }: { accounts?: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const snapshot = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data?.isSuperAdmin && !identity.data.mustChangePassword), retry: false });
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all'), [teamFilter, setTeamFilter] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null), [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: (command: OrganizationCommand) => { if (!identity.data) throw new Error('请先登录。'); return organizationCommand(command, identity.data.csrfToken); },
    onSuccess: async () => { setEditor(null); setNotice('已保存。'); await Promise.all(['organization', 'identity', 'v2'].map((key) => client.invalidateQueries({ queryKey: [key] }))); },
  });
  const data = snapshot.data, keyword = search.trim().toLocaleLowerCase();
  const matches = (...values: string[]) => values.some((value) => value.toLocaleLowerCase().includes(keyword));
  const displayName = (id: string) => data?.accounts.find((entry) => entry.id === id)?.displayName ?? '历史成员';
  const teamName = (id: string | null) => data?.teams.find((entry) => entry.id === id)?.name ?? '未加入团队';

  /** 打开时冻结表单与版本，查询刷新不能覆盖用户正在编辑的内容。 */
  function open(action: EditorAction, targetId?: string) { if (data) { save.reset(); setNotice(''); setEditor({ action, targetId, data }); } }
  if (identity.data && !identity.data.isSuperAdmin) return <Navigate to="/organization" replace />;
  const filteredAccounts = data?.accounts.filter((entry) => matches(entry.loginName, entry.displayName) && (status === 'all' || entry.disabled === (status === 'disabled')) && (teamFilter === 'all' || (teamFilter === 'none' ? !entry.teamId : entry.teamId === teamFilter))) ?? [];
  const filteredTeams = data?.teams.filter((team) => matches(team.name, displayName(team.leaderId))) ?? [];
  const editorTitle = editor?.action === 'set_disabled' ? editor.data.accounts.find((entry) => entry.id === editor.targetId)?.disabled ? '启用账号' : '停用账号' : editor ? actionLabels[editor.action] : '';
  return <main className="org-layout organization-page">
    <header className="org-header"><div><h1>{accounts ? '账号管理' : '团队管理'}</h1><p className="subtitle">{accounts ? '管理登录账号、角色、账号状态和密码。' : '维护团队信息，指定团队管理员。'}</p></div></header>
    {(identity.isPending || snapshot.isPending) && <p role="status">正在加载…</p>}
    {(identity.error || snapshot.error) && <p role="alert" className="form-error">{identity.error?.message || snapshot.error?.message}<button onClick={() => { void identity.refetch(); void snapshot.refetch(); }}>重试</button></p>}
    {data && !snapshot.isError && <>
      <div className="org-toolbar compact-org-toolbar">
        <label className="org-search"><span className="sr-only">搜索</span><input type="search" placeholder={accounts ? '账号或姓名' : '团队名称或管理员'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {accounts && <><label><span className="sr-only">状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select></label><label><span className="sr-only">所属团队</span><select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">全部团队</option><option value="none">未加入团队</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label></>}
        <button className="primary-button" onClick={() => open(accounts ? 'create_account' : 'create_team')}>{accounts ? '新增账号' : '新增团队'}</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="org-directory"><section className="panel org-table-wrap">{accounts ? <table className="org-table"><thead><tr><th>账号</th><th>姓名</th><th>团队</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {filteredAccounts.map((entry) => <tr key={entry.id}><td>{entry.loginName}</td><td>{entry.displayName}</td><td>{teamName(entry.teamId)}</td><td>{entry.isSuperAdmin ? '系统管理员' : '普通账号'}</td><td>{entry.disabled ? '已停用' : '已启用'}</td><td><div className="org-actions"><button onClick={() => open('update_account', entry.id)}>编辑</button><button disabled={entry.id === identity.data?.id} onClick={() => open('reset_password', entry.id)}>重置密码</button><button disabled={entry.id === identity.data?.id} onClick={() => open('set_disabled', entry.id)}>{entry.disabled ? '启用' : '停用'}</button><button disabled={entry.id === identity.data?.id} className="danger-button" onClick={() => open('delete_account', entry.id)}>删除</button></div></td></tr>)}
        {!filteredAccounts.length && <tr><td colSpan={6} className="org-empty">暂无符合条件的账号。</td></tr>}
      </tbody></table> : <table className="org-table"><thead><tr><th>团队名称</th><th>团队管理员</th><th>成员数</th><th>操作</th></tr></thead><tbody>{filteredTeams.map((team) => <tr key={team.id}><td><Link className="text-button" to={`/organization/${team.id}`}>{team.name}</Link></td><td>{displayName(team.leaderId)}</td><td>{data.accounts.filter((entry) => entry.teamId === team.id).length}</td><td><div className="org-actions"><button type="button" onClick={() => navigate(`/organization/${team.id}`)}>管理</button><button onClick={() => open('update_team', team.id)}>编辑</button><button className="danger-button" onClick={() => open('delete_team', team.id)}>删除</button></div></td></tr>)}{!filteredTeams.length && <tr><td colSpan={4} className="org-empty">暂无符合条件的团队。请先创建账号，再指定团队管理员。</td></tr>}</tbody></table>}</section></div>
    </>}
    {editor && <Dialog title={editorTitle} busy={save.isPending} onClose={() => setEditor(null)}>{save.error && <p role="alert" className="form-error">{save.error.message} 若数据已变更，请关闭弹窗后重新打开。</p>}<CommandForm action={editor.action} targetId={editor.targetId} data={editor.data} pending={save.isPending} submit={(command) => save.mutate(command)} cancel={() => setEditor(null)} /></Dialog>}
  </main>;
}
