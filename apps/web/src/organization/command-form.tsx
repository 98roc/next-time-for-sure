import { useState } from 'react';
import type { FormEvent } from 'react';
import { organizationCommandSchema } from '@ntfs/contracts';
import type { OrganizationCommand, OrganizationSnapshot, Role } from '@ntfs/contracts';

export const roleLabels: Record<Role, string> = { team_leader: '团队管理员', group_leader: '组长', project_manager: '项目经理', project_lead: '项目研发负责人', developer: '研发人员' };
export type EditorAction = Exclude<OrganizationCommand['action'], 'set_leader' | 'set_project_member' | 'set_project_members'>;
export const actionLabels: Record<EditorAction, string> = {
  create_account: '新增账号', update_account: '编辑账号', delete_account: '删除账号',
  create_team: '新增团队', update_team: '编辑团队', delete_team: '删除团队',
  create_member: '创建成员账号', link_member: '添加已有账号',
  create_group: '新增小组', update_group: '编辑小组', create_project: '新增项目',
  reset_password: '重置密码', set_disabled: '修改账号状态',
};

/** 每个弹窗只处理一个明确动作；使用打开时的快照版本，拒绝静默覆盖他人修改。 */
export function CommandForm({ action, targetId, data, pending, submit, cancel }: {
  action: EditorAction; targetId: string | undefined; data: OrganizationSnapshot; pending: boolean;
  submit: (command: OrganizationCommand) => void; cancel: () => void;
}) {
  const account = data.accounts.find((entry) => entry.id === targetId);
  const team = data.teams.find((entry) => entry.id === targetId) ?? data.teams[0];
  const group = data.groups.find((entry) => entry.id === targetId);
  const members = data.accounts.filter((entry) => entry.teamId === team?.id && !entry.disabled);
  const [error, setError] = useState('');
  const isGroup = action === 'create_group' || action === 'update_group';
  const creatingAccount = action === 'create_account' || action === 'create_member';
  const deleting = action === 'delete_account' || action === 'delete_team';
  const title = action === 'set_disabled' ? account?.disabled ? '启用账号' : '停用账号' : actionLabels[action];

  /** 将当前动作的输入交给统一契约校验，版本来自打开弹窗时的记录。 */
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '');
    const many = (key: string) => form.getAll(key).map(String);
    let input: unknown;
    switch (action) {
      case 'create_account': input = { action, loginName: value('loginName'), displayName: value('displayName'), password: value('password') }; break;
      case 'create_member': input = { action, teamId: team?.id, loginName: value('loginName'), displayName: value('displayName'), password: value('password') }; break;
      case 'update_account': input = { action, accountId: account?.id, loginName: value('loginName'), displayName: value('displayName'), version: account?.version }; break;
      case 'delete_account': input = { action, accountId: account?.id, version: account?.version }; break;
      case 'create_team': input = { action, name: value('name'), leaderId: value('leaderId') }; break;
      case 'update_team': input = { action, teamId: team?.id, name: value('name'), leaderId: value('leaderId'), version: team?.version }; break;
      case 'delete_team': input = { action, teamId: team?.id, version: team?.version }; break;
      case 'link_member': input = { action, teamId: team?.id, loginName: value('loginName') }; break;
      case 'create_group': input = { action, teamId: team?.id, name: value('name'), leaderId: value('leaderId'), memberIds: many('memberIds') }; break;
      case 'update_group': input = { action, groupId: group?.id, version: group?.version, name: value('name'), leaderId: value('leaderId'), memberIds: many('memberIds') }; break;
      case 'create_project': input = { action, teamId: team?.id, name: value('name'), managerId: value('managerId'), leadId: value('leadId'), developerIds: many('developerIds') }; break;
      case 'reset_password': input = { action, accountId: account?.id, password: value('password'), version: account?.version }; break;
      case 'set_disabled': input = { action, accountId: account?.id, disabled: !account?.disabled, version: account?.version }; break;
    }
    const parsed = organizationCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请补全有效输入。账号为3～64位字母、数字或点横线下划线，密码12～128位；小组须选择成员，项目成员须选择角色。'); return; }
    setError(''); submit(parsed.data);
  }

  const memberOptions = members.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}（{entry.loginName}）</option>);
  const leaders = data.accounts.filter((entry) => !entry.disabled && (!entry.teamId || (action === 'update_team' && entry.teamId === team?.id)));
  return <form className="org-editor" onSubmit={send}><fieldset disabled={pending}>
    {account && !creatingAccount && <p>账号：<strong>{account.displayName}</strong>（{account.loginName}）</p>}
    {deleting && <p>{action === 'delete_team' ? '确认删除“' + team?.name + '”？仅无其他成员、小组、项目或业务历史的团队可以删除，管理员账号保留。' : '确认删除此账号？已有团队关联或工作记录的账号不能删除，请改用停用。'}</p>}
    {action === 'set_disabled' && <p>{account?.disabled ? '启用后可以重新登录，原会话不会恢复。' : '停用后立即禁止登录和 Agent 调用，工作记录保留。'}</p>}
    {(creatingAccount || action === 'update_account' || action === 'link_member') && <label>登录账号<input name="loginName" required minLength={3} maxLength={64} autoComplete="off" defaultValue={action === 'update_account' ? account?.loginName : ''} /></label>}
    {(creatingAccount || action === 'update_account') && <label>姓名<input name="displayName" required maxLength={100} defaultValue={account?.displayName} /></label>}
    {(creatingAccount || action === 'reset_password') && <label>临时密码<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>12～128位；首次登录必须修改临时密码。</small></label>}
    {action === 'link_member' && <p className="subtitle">输入已有账号的登录名；该账号须已启用且未加入其他团队。</p>}
    {['create_team', 'update_team', 'create_group', 'update_group', 'create_project'].includes(action) && <label>名称<input name="name" required maxLength={100} defaultValue={action === 'update_team' ? team?.name : action === 'update_group' ? group?.name : ''} /></label>}
    {(action === 'create_team' || action === 'update_team') && <label>团队管理员<select name="leaderId" required defaultValue={action === 'update_team' ? team?.leaderId : ''}><option value="" disabled>请选择账号</option>{leaders.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}（{entry.loginName}）</option>)}</select><small>{leaders.length ? '新建团队使用未入团队账号；更换管理员也可选择本团队成员。' : '暂无可选账号，请先在账号管理中新增或启用账号。'}</small></label>}
    {isGroup && <><label>组长<select name="leaderId" required defaultValue={group?.leaderId}><option value="">请选择组长</option>{memberOptions}</select></label><fieldset className="checks"><legend>小组成员（须包含组长）</legend>{members.map((entry) => <label key={entry.id}><input type="checkbox" name="memberIds" value={entry.id} defaultChecked={group?.memberIds.includes(entry.id)} />{entry.displayName}</label>)}</fieldset></>}
    {action === 'create_project' && <><label>项目经理<select name="managerId" required><option value="">请选择项目经理</option>{memberOptions}</select></label><label>项目研发负责人<select name="leadId" required><option value="">请选择负责人</option>{memberOptions}</select></label><fieldset className="checks"><legend>研发人员（可兼任其他角色）</legend>{members.map((entry) => <label key={entry.id}><input type="checkbox" name="developerIds" value={entry.id} />{entry.displayName}</label>)}</fieldset></>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="org-actions"><button type="button" onClick={cancel}>取消</button><button className={deleting || (action === 'set_disabled' && !account?.disabled) ? 'danger-button' : 'primary-button'}>{pending ? '正在保存…' : deleting || action === 'set_disabled' ? '确认' + title : '保存'}</button></div>
  </fieldset></form>;
}
