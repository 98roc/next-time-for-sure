import { useState } from 'react';
import type { FormEvent } from 'react';
import { organizationCommandSchema, permissionSchema, projectRoleSchema, roleSchema } from '@ntfs/contracts';
import type { Identity, OrganizationCommand, OrganizationSnapshot, Permission, Role } from '@ntfs/contracts';

export const roleLabels: Record<Role, string> = { team_leader: '团队负责人', group_leader: '组长', project_manager: '项目经理', project_lead: '项目研发负责人', developer: '研发人员' };
const permissionLabels: Record<Permission, string> = { 'members.manage': '管理成员', 'groups.manage': '管理小组', 'projects.manage': '管理项目及角色', 'work.assign': '分配工作', 'requests.accept': '接收需求', 'milestones.manage': '维护里程碑', 'reports.publish': '发布周报', 'requests.submit': '提交需求', 'tasks.create': '创建团队任务' };
type Action = OrganizationCommand['action'];
const labels: Record<Action, string> = { create_team: '创建团队及负责人', create_member: '创建成员账号', link_member: '关联已有账号', set_leader: '变更团队负责人', create_group: '创建小组', update_group: '编辑小组', create_project: '创建项目', set_project_member: '设置项目成员角色', reset_password: '重置成员密码', set_disabled: '启用或停用账号', set_role_permissions: '配置预设角色权限' };

/** 仅用于界面入口显隐；最终授权始终由服务端执行。 */
function availableActions(identity: Identity, data: OrganizationSnapshot): Action[] {
  if (identity.isSuperAdmin) return ['create_team', 'set_leader', 'reset_password', 'set_disabled', 'set_role_permissions'];
  if (!data.teams.some((team) => team.leaderId === identity.id)) return [];
  const permissions = data.policies.find((entry) => entry.role === 'team_leader')?.permissions ?? [];
  return [
    ...(permissions.includes('members.manage') ? ['create_member', 'link_member', 'reset_password', 'set_disabled'] satisfies Action[] : []),
    ...(permissions.includes('groups.manage') ? ['create_group', 'update_group'] satisfies Action[] : []),
    ...(permissions.includes('projects.manage') ? ['create_project', 'set_project_member'] satisfies Action[] : []),
  ];
}

/** 管理表单使用当前快照版本，冲突后保留输入供用户刷新核对。 */
export function CommandForm({ identity, data, pending, submit }: { identity: Identity; data: OrganizationSnapshot; pending: boolean; submit: (command: OrganizationCommand) => void }) {
  const actions = availableActions(identity, data);
  const [selected, setSelected] = useState<Action>('create_team');
  const action = actions.includes(selected) ? selected : actions[0];
  const [teamId, setTeam] = useState(data.teams[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [role, setRole] = useState<Role>('team_leader');
  const [error, setError] = useState('');
  if (!action) return <p className="subtitle">你可以查看当前可见的组织目录；管理入口按角色权限开放。</p>;
  const groups = data.groups.filter((group) => group.teamId === teamId);
  const projects = data.projects.filter((project) => project.teamId === teamId);
  const members = data.accounts.filter((account) => account.teamId === teamId);
  const group = groups.find((entry) => entry.id === target) ?? groups[0];
  const project = projects.find((entry) => entry.id === target) ?? projects[0];
  const policy = data.policies.find((entry) => entry.role === role);
  const isGroup = action === 'create_group' || action === 'update_group';

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '');
    const many = (key: string) => form.getAll(key).map(String);
    const account = data.accounts.find((entry) => entry.id === value('accountId'));
    let input: unknown;
    switch (action) {
      case 'create_team': input = { action, name: value('name'), leader: { loginName: value('loginName'), displayName: value('displayName'), password: value('password') } }; break;
      case 'create_member': input = { action, teamId, loginName: value('loginName'), displayName: value('displayName'), password: value('password') }; break;
      case 'link_member': input = { action, teamId, loginName: value('loginName') }; break;
      case 'set_leader': input = { action, teamId, accountId: value('accountId'), version: data.teams.find((entry) => entry.id === teamId)?.version }; break;
      case 'create_group': input = { action, teamId, name: value('name'), leaderId: value('leaderId'), memberIds: many('memberIds') }; break;
      case 'update_group': input = { action, groupId: group?.id, version: group?.version, name: value('name'), leaderId: value('leaderId'), memberIds: many('memberIds') }; break;
      case 'create_project': input = { action, teamId, name: value('name'), managerId: value('managerId'), leadId: value('leadId'), developerIds: many('developerIds') }; break;
      case 'set_project_member': input = { action, projectId: project?.id, version: project?.version, accountId: value('accountId'), roles: many('roles') }; break;
      case 'reset_password': input = { action, accountId: value('accountId'), password: value('password'), version: account?.version }; break;
      case 'set_disabled': input = { action, accountId: value('accountId'), disabled: value('disabled') === 'true', version: account?.version }; break;
      case 'set_role_permissions': input = { action, role, permissions: many('permissions'), version: policy?.version }; break;
    }
    const parsed = organizationCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请补全有效的输入：账号为3～64位字母、数字或点横线下划线，密码12～128位；小组至少选择一名成员，项目成员至少选择一个角色。'); return; }
    setError(''); submit(parsed.data);
  }

  const accountOptions = (all = false) => (all ? data.accounts : members).filter((account) => !account.disabled).map((account) => <option key={account.id} value={account.id}>{account.displayName}（{account.loginName}）</option>);
  return <section className="panel org-editor"><h2>组织管理</h2>
    <label>操作<select value={action} onChange={(event) => { const next = actions.find((item) => item === event.target.value); if (next) { setSelected(next); setTarget(''); setError(''); } }}>{actions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label>
    <form key={`${action}:${teamId}:${target}:${role}`} onSubmit={send}>
      <fieldset disabled={pending}>
      {!['create_team', 'reset_password', 'set_disabled', 'set_role_permissions'].includes(action) && <label>团队<select value={teamId} required onChange={(event) => { setTeam(event.target.value); setTarget(''); }}>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      {action === 'update_group' && <label>小组<select value={group?.id ?? ''} required onChange={(event) => setTarget(event.target.value)}>{groups.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
      {action === 'set_project_member' && <label>项目<select value={project?.id ?? ''} required onChange={(event) => setTarget(event.target.value)}>{projects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
      {['create_team', 'create_group', 'update_group', 'create_project'].includes(action) && <label>名称<input name="name" required maxLength={100} defaultValue={action === 'update_group' ? group?.name : ''} /></label>}
      {['create_team', 'create_member', 'link_member'].includes(action) && <label>{action === 'create_team' ? '负责人账号' : '登录账号'}<input name="loginName" required minLength={3} maxLength={64} autoComplete="off" /></label>}
      {['create_team', 'create_member'].includes(action) && <label>显示姓名<input name="displayName" required maxLength={100} /></label>}
      {['create_team', 'create_member', 'reset_password'].includes(action) && <label>临时密码<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>12～128位；请安全交给本人，首次登录必须改密。</small></label>}
      {['set_leader', 'set_project_member', 'reset_password', 'set_disabled'].includes(action) && <label>成员<select name="accountId" required>{(action === 'reset_password' || action === 'set_disabled') ? data.accounts.filter((entry) => entry.id !== identity.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}（{entry.loginName}）{entry.disabled ? ' · 已停用' : ''}</option>) : accountOptions()}</select></label>}
      {isGroup && <><label>组长<select name="leaderId" required defaultValue={group?.leaderId}>{accountOptions()}</select></label><fieldset className="checks"><legend>小组成员（可同时加入多个小组）</legend>{members.filter((entry) => !entry.disabled).map((entry) => <label key={entry.id}><input type="checkbox" name="memberIds" value={entry.id} defaultChecked={action === 'update_group' && group?.memberIds.includes(entry.id)} />{entry.displayName}</label>)}</fieldset></>}
      {action === 'create_project' && <><label>项目经理<select name="managerId" required>{accountOptions()}</select></label><label>项目研发负责人<select name="leadId" required>{accountOptions()}</select></label><fieldset className="checks"><legend>研发人员（可兼任其他角色）</legend>{members.filter((entry) => !entry.disabled).map((entry) => <label key={entry.id}><input type="checkbox" name="developerIds" value={entry.id} />{entry.displayName}</label>)}</fieldset></>}
      {action === 'set_project_member' && <fieldset className="checks"><legend>本次保存的全部项目角色</legend>{projectRoleSchema.options.map((item) => <label key={item}><input type="checkbox" name="roles" value={item} />{roleLabels[item]}</label>)}</fieldset>}
      {action === 'set_disabled' && <label>账号状态<select name="disabled"><option value="true">停用账号并撤销会话</option><option value="false">启用账号（需要重新登录）</option></select></label>}
      {action === 'set_role_permissions' && <><label>预设角色<select value={role} onChange={(event) => setRole(roleSchema.parse(event.target.value))}>{roleSchema.options.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}</select></label><fieldset className="checks"><legend>允许操作（仍受团队、项目及个人隐私边界限制）</legend>{permissionSchema.options.map((item) => <label key={item}><input type="checkbox" name="permissions" value={item} defaultChecked={policy?.permissions.includes(item)} />{permissionLabels[item]}</label>)}</fieldset></>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="primary-button" disabled={pending}>{pending ? '正在保存…' : '保存'}</button>
      </fieldset>
    </form>
  </section>;
}
