import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationCommand, OrganizationSnapshot } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { OverviewPanel } from '../lifecycle/overview-panel';
import { Dialog } from '../layout/dialog';
import { EmptyState } from '../layout/empty-state';
import { organizationCommand, organizationSnapshot } from './api';
import { CommandForm, actionLabels, roleLabels } from './command-form';
import { ProjectMembersDialog } from './project-members-dialog';
import type { EditorAction } from './command-form';
import './organization.css';

type Editor = { action: EditorAction; targetId: string | undefined; data: OrganizationSnapshot };

/** 超管目录仅提供账号和团队；团队内操作按当前管理员身份呈现。 */
export function OrganizationPage({ accounts = false }: { accounts?: boolean }) {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const snapshot = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data && !identity.data.mustChangePassword), retry: false });
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') ?? 'members';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState('');
  const [membersProjectId, setMembersProjectId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (command: OrganizationCommand) => {
      if (!identity.data) throw new Error('请先登录。');
      return organizationCommand(command, identity.data.csrfToken);
    },
    onSuccess: async () => {
      setEditor(null); setNotice('已保存。');
      await Promise.all(['organization', 'handoff', 'overview', 'identity'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
  const data = snapshot.data;
  const admin = identity.data?.isSuperAdmin ?? false;
  const lead = data?.teams.some((team) => team.leaderId === identity.data?.id) ?? false;
  const view = admin ? accounts ? 'accounts' : 'teams' : ['members', 'groups', 'projects', ...(lead ? ['overview'] : [])].includes(tab) ? tab : 'members';
  const title = admin ? accounts ? '账号管理' : '团队管理' : lead ? '团队管理' : '团队成员';
  const keyword = search.trim().toLocaleLowerCase();
  const matches = (...values: string[]) => values.some((value) => value.toLocaleLowerCase().includes(keyword));
  const displayName = (id: string) => data?.accounts.find((entry) => entry.id === id)?.displayName ?? '历史成员';
  const teamName = (id: string | null) => data?.teams.find((entry) => entry.id === id)?.name ?? '未加入团队';

  /** 保存打开时的版本与默认值；后台刷新不能悄悄替换正在编辑的对象。 */
  function open(action: EditorAction, targetId?: string) {
    if (!data) return;
    save.reset(); setNotice(''); setEditor({ action, targetId, data });
  }

  if (identity.data && accounts && !admin) return <Navigate to="/organization" replace />;
  const filteredAccounts = data?.accounts.filter((entry) => matches(entry.loginName, entry.displayName) && (status === 'all' || entry.disabled === (status === 'disabled')) && (teamFilter === 'all' || (teamFilter === 'none' ? !entry.teamId : entry.teamId === teamFilter))) ?? [];
  const filteredTeams = data?.teams.filter((team) => matches(team.name, displayName(team.leaderId))) ?? [];
  const editorTitle = editor?.action === 'set_disabled' ? editor.data.accounts.find((entry) => entry.id === editor.targetId)?.disabled ? '启用账号' : '停用账号' : editor ? actionLabels[editor.action] : '';
  return <main className="org-layout organization-page">
    <header className="org-header"><div><h1>{title}</h1><p className="subtitle">{admin ? accounts ? '管理登录账号、账号状态和密码。' : '维护团队信息，指定团队管理员。' : (data?.teams[0]?.name ?? '管理本团队的成员、小组与项目')}</p></div></header>
    {identity.isPending || snapshot.isPending ? <p role="status">正在加载…</p> : null}
    {(identity.error || snapshot.error) && <p role="alert" className="form-error">{identity.error?.message || snapshot.error?.message}<button onClick={() => { void identity.refetch(); void snapshot.refetch(); }}>重试</button></p>}
    {data && !snapshot.isError && <>
      {lead && !data.projects.length && <div className="setup-banner"><div><h2>让团队开始协作</h2><p>添加成员 → 创建项目 → 分配任务</p></div><Link className="button-link primary-button" to="/work?create=project">创建第一个项目</Link></div>}
      {!admin && <div className="view-tabs" aria-label="团队管理视图">{[{ value: 'members', label: '成员' }, { value: 'groups', label: '小组' }, { value: 'projects', label: '项目' }, ...(lead ? [{ value: 'overview', label: '团队总览' }] : [])].map((entry) => <button key={entry.value} aria-pressed={view === entry.value} onClick={() => { setParams({ view: entry.value }); setSearch(''); setStatus('all'); }}>{entry.label}</button>)}</div>}
      {!admin && <p className="section-description">{view === 'members' ? lead ? '先添加协作成员，再在小组与项目中分配职责。' : '查看团队成员、小组和你参与的项目。' : view === 'groups' ? '按协作需要设置小组和组长；无小组成员可使用团队直属分工。' : view === 'projects' ? '设置项目成员与角色；日常任务请从项目工作区进入。' : '查看团队当前工作与待处理事项。'}</p>}
      <div className="org-toolbar compact-org-toolbar">
        {view !== 'overview' && <label className="org-search"><span className="sr-only">搜索</span><input type="search" placeholder={view === 'teams' ? '团队名称或管理员' : view === 'accounts' || view === 'members' ? '账号或姓名' : '名称'} value={search} onChange={(event) => setSearch(event.target.value)} /></label>}
        {(view === 'accounts' || view === 'members') && <label><span className="sr-only">状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select></label>}
        {view === 'accounts' && <label><span className="sr-only">所属团队</span><select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">全部团队</option><option value="none">未加入团队</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        <div className="org-actions">
          {view === 'accounts' && <button className="primary-button" onClick={() => open('create_account')}>新增账号</button>}
          {view === 'teams' && <button className="primary-button" onClick={() => open('create_team')}>新增团队</button>}
          {lead && view === 'members' && <><button className="primary-button" onClick={() => open('create_member')}>创建成员账号</button><button onClick={() => open('link_member')}>添加已有账号</button><Link to="/management">移出与交接</Link></>}
          {lead && view === 'groups' && <button className="primary-button" onClick={() => open('create_group')}>新增小组</button>}
          {lead && view === 'projects' && <><button className="primary-button" onClick={() => open('create_project')}>新增项目</button><Link to="/management">归档与交接</Link></>}
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="org-directory">
        {(view === 'accounts' || view === 'members') && <section className="panel org-table-wrap"><table className="org-table"><thead><tr><th>账号</th><th>姓名</th>{admin && <th>团队</th>}<th>状态</th>{(admin || lead) && <th>操作</th>}</tr></thead><tbody>
          {filteredAccounts.map((entry) => <tr key={entry.id}><td>{entry.loginName}</td><td>{entry.displayName}{data.teams.some((team) => team.leaderId === entry.id) && <small className="org-role">团队管理员</small>}</td>{admin && <td>{teamName(entry.teamId)}</td>}<td><span className={'org-status ' + (entry.disabled ? 'is-disabled' : '')}>{entry.disabled ? '已停用' : '已启用'}</span></td>{(admin || lead) && <td><div className="org-actions">
            {admin && <button onClick={() => open('update_account', entry.id)}>编辑</button>}
            {entry.id !== identity.data?.id && <><button onClick={() => open('reset_password', entry.id)}>重置密码</button><button onClick={() => open('set_disabled', entry.id)}>{entry.disabled ? '启用' : '停用'}</button></>}
            {admin && <button className="danger-button" onClick={() => open('delete_account', entry.id)}>删除</button>}
          </div></td>}</tr>)}
          {filteredAccounts.length === 0 && <tr><td colSpan={admin ? 5 : lead ? 4 : 3} className="org-empty">暂无符合条件的账号。</td></tr>}
        </tbody></table></section>}
        {view === 'teams' && <section className="panel org-table-wrap"><table className="org-table"><thead><tr><th>团队名称</th><th>团队管理员</th><th>成员数</th><th>操作</th></tr></thead><tbody>{filteredTeams.map((team) => <tr key={team.id}><td>{team.name}</td><td>{displayName(team.leaderId)}</td><td>{data.accounts.filter((entry) => entry.teamId === team.id).length}</td><td><div className="org-actions"><button onClick={() => open('update_team', team.id)}>编辑</button><button className="danger-button" onClick={() => open('delete_team', team.id)}>删除</button></div></td></tr>)}{filteredTeams.length === 0 && <tr><td colSpan={4} className="org-empty">暂无符合条件的团队。请先创建账号，再指定团队管理员。</td></tr>}</tbody></table></section>}
        {view === 'groups' && <section className="org-list">{data.groups.filter((group) => matches(group.name)).map((group) => <article key={group.id}><div className="org-row-heading"><h2>{group.name}</h2>{lead && <button onClick={() => open('update_group', group.id)}>编辑</button>}</div><p>组长：{displayName(group.leaderId)}</p><p>{group.memberIds.map(displayName).join('、')}</p></article>)}{!data.groups.some((group) => matches(group.name)) && <EmptyState title={search ? '没有匹配的小组' : '先创建一个负责小组'} description={search ? '试试其他名称。' : lead ? '按协作需要设置成员和组长；也可直接分配团队直属工作。' : '团队管理员建立小组后，你可以认领小组工作。'}>{!search && lead && <button className="primary-button" onClick={() => open('create_group')}>＋ 创建小组</button>}</EmptyState>}</section>}
        {view === 'projects' && <section className="org-list">{data.projects.filter((project) => matches(project.name)).map((project) => <article key={project.id}><div className="org-row-heading"><h2>{project.name}{project.archived && <small> · 已归档</small>}</h2><div className="org-actions"><Link to={`/work?projectId=${project.id}`}>进入项目 →</Link>{lead && <button onClick={() => setMembersProjectId(project.id)}>管理成员</button>}</div></div>{project.members.map((member) => <p key={member.accountId}>{displayName(member.accountId)} · {member.roles.map((role) => roleLabels[role]).join('、')}</p>)}</article>)}{!data.projects.some((project) => matches(project.name)) && <EmptyState title={search ? '没有匹配的项目' : '还没有项目'} description={search ? '试试其他名称。' : lead ? '创建项目并指定负责人，让团队工作有明确归属。' : '请联系团队管理员将你加入项目。'}>{!search && lead && <Link className="button-link primary-button" to="/work?create=project">＋ 创建项目</Link>}</EmptyState>}</section>}
        {view === 'overview' && identity.data && <OverviewPanel accountId={identity.data.id} />}
      </div>
    </>}
    {membersProjectId && identity.data && <ProjectMembersDialog projectId={membersProjectId} accountId={identity.data.id} csrf={identity.data.csrfToken} onClose={() => setMembersProjectId(null)} />}
    {editor && <Dialog title={editorTitle} busy={save.isPending} onClose={() => setEditor(null)}>
      {save.error && <p role="alert" className="form-error">{save.error.message} 若数据已变更，请关闭弹窗后重新打开。<button disabled={save.isPending} onClick={() => { void snapshot.refetch(); }}>刷新列表</button></p>}
      <CommandForm action={editor.action} targetId={editor.targetId} data={editor.data} pending={save.isPending} submit={(command) => save.mutate(command)} cancel={() => setEditor(null)} />
    </Dialog>}
  </main>;
}
