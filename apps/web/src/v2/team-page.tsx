import { TeamMessages } from './team-messages';
import { useId, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { projectRoleSchema, v2TeamCommandSchema, type V2Workspace } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';
import { AccountForm } from './member-form';
import { readMemberImpact } from './api';
import { TaskEditor } from './task-editor';
import { MilestoneDetail } from './milestones';

const roles = { project_manager: '项目经理', project_lead: '项目研发负责人', developer: '研发人员' };
type Project = V2Workspace['projects'][number];

/** 团队管理仅成员和项目两页签，首页标语在管理入口维护。 */
export function TeamPageV2() {
  const { data, user, selectTeam } = useWorkspace(), modal = useModal(), [tab, setTab] = useState<'members' | 'projects'>('members'), [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  if (!data.teamLeader || !data.team) return <Navigate to="/personal" replace />;
  const team = data.team;
  const accounts = data.accounts.filter((row) => row.teamId === team.id && `${row.loginName} ${row.displayName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === 'all' || row.disabled === (status === 'disabled')));
  const name = (id: string) => data.accounts.find((row) => row.id === id)?.displayName ?? '历史成员';
  return <>{user.isSuperAdmin && <Link className="nt-link v2-team-back" to="/organization">← 返回团队列表</Link>}<div className="nt-row nt-between"><div><h2>团队管理</h2><p className="nt-muted">{team.name}</p></div><button className="nt-quiet" onClick={() => modal.open(<TeamMessages />)}>首页标语</button></div><div className="nt-tabs"><button aria-pressed={tab === 'members'} onClick={() => { setTab('members'); setSearch(''); }}>成员</button><button aria-pressed={tab === 'projects'} onClick={() => { setTab('projects'); setSearch(''); }}>项目</button></div>
    <div className="nt-tools"><div className="nt-row"><input aria-label="搜索" placeholder={tab === 'members' ? '账号或姓名' : '项目名称'} value={search} onChange={(event) => setSearch(event.target.value)} />{tab === 'members' && <select aria-label="账号状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>}</div><div className="nt-row">{tab === 'members' ? <button className="nt-primary" onClick={() => modal.open(<AddMember />)}>新增成员</button> : <button className="nt-primary" onClick={() => modal.open(<ProjectForm />)}>新增项目</button>}</div></div>
    <div className="nt-project nt-scroll">{tab === 'members' ? <table className="nt-table"><thead><tr><th>账号</th><th>姓名</th><th>状态</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td>{account.loginName}</td><td>{account.displayName}{account.id === team.leaderId && <small className="v2-option-note">团队负责人</small>}</td><td>{account.disabled ? '已停用' : '已启用'}</td><td>{account.id !== user.id && (user.isSuperAdmin || !account.isSuperAdmin) && <div className="nt-row"><button onClick={() => modal.open(<AccountForm action="reset_password" user={user} accounts={data.accounts} teams={[team]} accountId={account.id} />)}>重置密码</button><button onClick={() => modal.open(<AccountForm action="set_disabled" user={user} accounts={data.accounts} teams={[team]} accountId={account.id} />)}>{account.disabled ? '启用' : '停用'}</button></div>}</td></tr>)}</tbody></table> : <table className="nt-table"><thead><tr><th>项目名称</th><th>项目经理</th><th>项目研发负责人</th><th>成员数量</th><th>操作</th></tr></thead><tbody>{data.projects.filter((row) => row.name.includes(search)).map((project) => <tr key={project.id}><td>{project.name}</td><td>{project.members.filter((row) => row.roles.includes('project_manager')).map((row) => name(row.accountId)).join('、')}</td><td>{project.members.filter((row) => row.roles.includes('project_lead')).map((row) => name(row.accountId)).join('、')}</td><td>{project.members.length}</td><td><div className="nt-row"><button onClick={() => modal.open(<ProjectForm project={project} />)}>编辑</button><button onClick={() => modal.open(<ProjectForm project={project} membersOnly />)}>管理成员</button><Link onClick={() => selectTeam(team.id)} to={`/work?project=${project.id}&tab=tasks`}>进入项目 →</Link></div></td></tr>)}</tbody></table>}</div>
  </>;
}

/** 保存整份成员集合，搜索不会丢掉隐藏行，多种负责人角色允许多人兼任。 */
function ProjectForm({ project, membersOnly = false }: { project?: Project; membersOnly?: boolean }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const [name, setName] = useState(project?.name ?? ''), [members, setMembers] = useState<Project['members']>(project?.members ?? []), [search, setSearch] = useState('');
  const [blockers, setBlockers] = useState<{ kind: string; id: string; title: string; accountId: string | null }[]>([]);
  const visible = data.accounts.filter((row) => row.teamId === data.team?.id && `${row.displayName} ${row.loginName}`.includes(search));
  const dirty = name !== (project?.name ?? '') || JSON.stringify(members) !== JSON.stringify(project?.members ?? []);
  function toggle(id: string, role: keyof typeof roles, checked: boolean) {
    setMembers((previous) => { const original = previous.find((row) => row.accountId === id), nextRoles = checked ? [...new Set([...(original?.roles ?? []), role])] : (original?.roles ?? []).filter((value) => value !== role); return [...previous.filter((row) => row.accountId !== id), ...(nextRoles.length ? [{ accountId: id, roles: nextRoles }] : [])]; });
    setBlockers([]);
  }
  function selectMembers(ids: string[], selected: boolean) {
    setMembers((previous) => selected ? [...previous, ...ids.filter((id) => !previous.some((row) => row.accountId === id)).map((accountId) => ({ accountId, roles: [projectRoleSchema.enum.developer] }))] : previous.filter((row) => !ids.includes(row.accountId)));
    setBlockers([]);
  }
  async function save() {
    const parsed = v2TeamCommandSchema.safeParse(project ? { action: 'update_project', operationId: createOperationId(), projectId: project.id, version: project.version, name, members } : { action: 'create_project', operationId: createOperationId(), name, members });
    if (!parsed.success) throw new Error('请填写项目名称并选择成员；每名成员至少具有一种角色。');
    if (project) { const impact = await readMemberImpact({ projectId: project.id, version: project.version, members }, data.team?.id); setBlockers(impact.blockers); if (impact.blockers.length) throw new Error('请先处理下方阻塞项，再保存成员配置。'); }
    await run('team', parsed.data); modal.finish();
  }
  return <ModalPage title={project ? membersOnly ? '管理项目成员' : '编辑项目' : '新增项目'} dirty={dirty} busy={action.busy} wide actions={<button className="nt-primary" form={formId} type="submit" disabled={action.busy}>保存</button>}><form id={formId} onSubmit={(event) => { event.preventDefault(); void action.act(save); }}><fieldset disabled={action.busy}>
    {membersOnly ? <h3>{name}</h3> : <Field label="项目名称"><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></Field>}
    <p className="v2-context">项目经理和项目研发负责人各至少一人，均可多人；勾选角色会自动纳入项目成员。</p><Field label="搜索成员"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="账号或姓名" /></Field>
    <div className="nt-scroll"><table className="nt-table"><thead><tr><th><input type="checkbox" aria-label="全选当前可用成员" checked={visible.some((row) => !row.disabled) && visible.filter((row) => !row.disabled).every((row) => members.some((member) => member.accountId === row.id))} onChange={(event) => selectMembers(visible.filter((row) => !row.disabled).map((row) => row.id), event.target.checked)} /></th><th>成员</th>{projectRoleSchema.options.map((role) => <th key={role}>{roles[role]}</th>)}</tr></thead><tbody>{visible.map((account) => <tr key={account.id}><td><input type="checkbox" aria-label={`${account.displayName}：加入项目`} checked={members.some((row) => row.accountId === account.id)} disabled={account.disabled && !project?.members.some((row) => row.accountId === account.id)} onChange={(event) => selectMembers([account.id], event.target.checked)} /></td><td>{account.displayName}<small className="v2-option-note">{account.loginName}{account.disabled ? ' · 已停用' : ''}</small></td>{projectRoleSchema.options.map((role) => { const checked = members.some((row) => row.accountId === account.id && row.roles.includes(role)); return <td key={role}><input type="checkbox" aria-label={`${account.displayName}：${roles[role]}`} checked={checked} disabled={account.disabled && !project?.members.some((row) => row.accountId === account.id && row.roles.includes(role))} onChange={(event) => toggle(account.id, role, event.target.checked)} /></td>; })}</tr>)}</tbody></table></div>
    <Feedback error={action.error} />{blockers.length > 0 && <section className="v2-blockers"><h3>移出前需要处理</h3><ul>{blockers.map((row) => <li key={`${row.kind}:${row.id}`}>{row.accountId && `${data.accounts.find((item) => item.id === row.accountId)?.displayName ?? '成员'}：`}{row.kind === 'task' ? <button type="button" className="nt-link" onClick={() => { const task = data.tasks.find((item) => item.id === row.id); if (task) modal.push(<TaskEditor task={task} />); }}>{row.title}</button> : row.kind === 'milestone' ? <button type="button" className="nt-link" onClick={() => modal.push(<MilestoneDetail milestoneId={row.id} />)}>{row.title}</button> : row.title}</li>)}</ul></section>}
  </fieldset></form></ModalPage>;
}

/** 新增成员入口集中选择创建账号或关联已有账号，避免并列重复入口。 */
function AddMember() {
  const { data, user } = useWorkspace(), modal = useModal(), team = data.team;
  return <ModalPage title="新增成员"><p className="v2-context">创建新账号，或将已有的可用账号加入本团队。</p><div className="nt-row">{team && <><button onClick={() => modal.push(<AccountForm action="create_member" user={user} accounts={data.accounts} teams={[team]} teamId={team.id} />)}>创建成员账号</button><button onClick={() => modal.push(<AccountForm action="link_member" user={user} accounts={data.accounts} teams={[team]} teamId={team.id} />)}>添加已有账号</button></>}</div></ModalPage>;
}
