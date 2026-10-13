import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationCommand } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationCommand, organizationSnapshot } from './api';
import { CommandForm, roleLabels } from './command-form';
import './organization.css';

/** 组织目录与管理入口共用当前身份，未经登录或改密不加载组织数据。 */
export function OrganizationPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const snapshot = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: Boolean(identity.data && !identity.data.mustChangePassword), retry: false });
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const save = useMutation({
    mutationFn: (command: OrganizationCommand) => { if (!identity.data) throw new Error('请先登录。'); return organizationCommand(command, identity.data.csrfToken); },
    onSuccess: async () => { setNotice('已保存。'); setRevision((value) => value + 1); await client.invalidateQueries({ queryKey: ['organization'] }); },
  });
  const data = snapshot.data;
  const displayName = (id: string) => data?.accounts.find((entry) => entry.id === id)?.displayName ?? '成员不可见';
  return <main className="org-layout"><header className="org-header"><div><p className="eyebrow">下次一定 · 工作空间</p><h1>团队与项目</h1><p className="subtitle">维护成员与职责，让每个人清楚自己的协作范围。</p></div><nav><a href="/account">账号与安全</a><a href="/">工程状态</a></nav></header>
    {identity.isPending ? <p role="status">正在检查登录状态…</p> : identity.isError ? <p role="alert">无法获取身份，请<a href="/account">重新连接</a>。</p> : !identity.data ? <p>请先<a href="/account">登录</a>。</p> : identity.data.mustChangePassword ? <p>请先<a href="/account">修改临时密码</a>。</p> : <>
      {snapshot.isPending && <p role="status">正在加载组织目录…</p>}
      {snapshot.isError && <p role="alert">{snapshot.error.message}</p>}
      <div className="org-feedback"><button disabled={snapshot.isFetching || save.isPending} onClick={() => { save.reset(); setNotice(''); setRevision((value) => value + 1); void snapshot.refetch(); }}>刷新目录</button>{notice && <span role="status">{notice}</span>}</div>
      {save.isError && <p className="form-error" role="alert">{save.error.message} 如数据已变更，请刷新目录，核对最新内容后重新填写。</p>}
      {data && !snapshot.isError && <div className="org-columns"><div className="org-directory">
        <section className="panel"><h2>团队</h2>{data.teams.length ? data.teams.map((team) => <article key={team.id}><h3>{team.name}</h3><p>负责人 · {displayName(team.leaderId)}</p></article>) : <p className="subtitle">暂无团队，由超管创建团队并指定负责人。</p>}</section>
        <section className="panel"><h2>成员 <small>{data.accounts.length}</small></h2>{data.accounts.length ? <ul>{data.accounts.map((account) => <li key={account.id}><strong>{account.displayName}</strong><span>{account.loginName} · {account.disabled ? '已停用' : '已启用'} · {data.teams.find((team) => team.id === account.teamId)?.name ?? '尚未加入团队'}</span></li>)}</ul> : <p className="subtitle">暂无成员。</p>}</section>
        <section className="panel"><h2>小组</h2>{data.groups.length ? data.groups.map((group) => <article key={group.id}><h3>{group.name}</h3><p>组长 · {displayName(group.leaderId)}</p><p>{group.memberIds.map(displayName).join('、')}</p></article>) : <p className="subtitle">暂无小组。</p>}</section>
        <section className="panel"><h2>项目</h2>{data.projects.length ? data.projects.map((project) => <article key={project.id}><h3>{project.name}</h3><a href={`/work?projectId=${project.id}`}>查看需求与任务</a>{project.members.map((member) => <p key={member.accountId}>{displayName(member.accountId)} · {member.roles.map((role) => roleLabels[role]).join('、')}</p>)}</article>) : <p className="subtitle">暂无可见项目。</p>}</section>
      </div><CommandForm key={`${revision}:${snapshot.dataUpdatedAt}`} identity={identity.data} data={data} pending={save.isPending} submit={(command) => { setNotice(''); save.mutate(command); }} /></div>}
    </>}
  </main>;
}
