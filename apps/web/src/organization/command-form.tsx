import { useState } from 'react';
import type { FormEvent } from 'react';
import { organizationCommandSchema, passwordHint, passwordMaxLength, passwordMinLength, passwordPattern } from '@ntfs/contracts';
import type { OrganizationCommand, OrganizationSnapshot } from '@ntfs/contracts';

export type EditorAction = Exclude<OrganizationCommand['action'], 'set_leader'>;
export const actionLabels: Record<EditorAction, string> = {
  create_account: '新增账号', update_account: '编辑账号', delete_account: '删除账号',
  create_team: '新增团队', update_team: '编辑团队', delete_team: '删除团队',
  create_member: '创建成员账号', link_member: '添加已有账号',
  reset_password: '重置密码', set_disabled: '修改账号状态',
};

/** 每个弹窗只处理一个明确动作；使用打开时的快照版本，拒绝静默覆盖他人修改。 */
export function CommandForm({ action, targetId, data, pending, submit, cancel }: {
  action: EditorAction; targetId: string | undefined; data: OrganizationSnapshot; pending: boolean;
  submit: (command: OrganizationCommand) => void; cancel: () => void;
}) {
  const account = data.accounts.find((entry) => entry.id === targetId);
  const team = data.teams.find((entry) => entry.id === targetId) ?? data.teams[0];
  const [error, setError] = useState('');
  const creatingAccount = action === 'create_account' || action === 'create_member';
  const deleting = action === 'delete_account' || action === 'delete_team';
  const title = action === 'set_disabled' ? account?.disabled ? '启用账号' : '停用账号' : actionLabels[action];

  /** 将当前动作的输入交给统一契约校验，版本来自打开弹窗时的记录。 */
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '');
    let input: unknown;
    switch (action) {
      case 'create_account': input = { action, loginName: value('loginName'), displayName: value('displayName'), password: value('password'), isSuperAdmin: value('role') === 'admin' }; break;
      case 'create_member': input = { action, teamId: team?.id, loginName: value('loginName'), displayName: value('displayName'), password: value('password') }; break;
      case 'update_account': input = { action, accountId: account?.id, loginName: value('loginName'), displayName: value('displayName'), isSuperAdmin: value('role') === 'admin', version: account?.version }; break;
      case 'delete_account': input = { action, accountId: account?.id, version: account?.version }; break;
      case 'create_team': input = { action, name: value('name'), leaderId: value('leaderId') }; break;
      case 'update_team': input = { action, teamId: team?.id, name: value('name'), leaderId: value('leaderId'), version: team?.version }; break;
      case 'delete_team': input = { action, teamId: team?.id, version: team?.version }; break;
      case 'link_member': input = { action, teamId: team?.id, loginName: value('loginName') }; break;
      case 'reset_password': input = { action, accountId: account?.id, password: value('password'), version: account?.version }; break;
      case 'set_disabled': input = { action, accountId: account?.id, disabled: !account?.disabled, version: account?.version }; break;
    }
    const parsed = organizationCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请补全有效输入。账号为3～64位字母、数字或点横线下划线；密码' + passwordHint + ''); return; }
    setError(''); submit(parsed.data);
  }

  const leaders = data.accounts.filter((entry) => !entry.disabled && (!entry.teamId || (action === 'update_team' && entry.teamId === team?.id)));
  return <form className="org-editor" onSubmit={send}><fieldset disabled={pending}>
    {account && !creatingAccount && <p>账号：<strong>{account.displayName}</strong>（{account.loginName}）</p>}
    {deleting && <p>{action === 'delete_team' ? '确认删除“' + team?.name + '”？仅无其他成员、项目或业务历史的团队可以删除，管理员账号保留。' : '确认删除此账号？已有团队关联或工作记录的账号不能删除，请改用停用。'}</p>}
    {action === 'set_disabled' && <p>{account?.disabled ? '启用后可以重新登录，原会话不会恢复。' : '停用后立即禁止登录和 Agent 调用，工作记录保留。'}</p>}
    {(creatingAccount || action === 'update_account' || action === 'link_member') && <label>登录账号<input name="loginName" required minLength={3} maxLength={64} autoComplete="off" defaultValue={action === 'update_account' ? account?.loginName : ''} /></label>}
    {(creatingAccount || action === 'update_account') && <label>姓名<input name="displayName" required maxLength={100} defaultValue={account?.displayName} /></label>}
    {(action === 'create_account' || action === 'update_account') && <label>角色<select name="role" aria-label="角色" defaultValue={account?.isSuperAdmin ? 'admin' : 'member'}><option value="member">普通账号</option><option value="admin">系统管理员</option></select><small>系统管理员可管理账号、团队和所有项目，私人内容仍仅本人可见。</small></label>}
    {(creatingAccount || action === 'reset_password') && <label>临时密码<input type="password" name="password" required minLength={passwordMinLength} maxLength={passwordMaxLength} pattern={passwordPattern.source} title={passwordHint} autoComplete="new-password" /><small>{passwordHint}首次登录必须修改临时密码。</small></label>}
    {action === 'link_member' && <p className="subtitle">输入已有账号的登录名；该账号须已启用且未加入其他团队。</p>}
    {['create_team', 'update_team'].includes(action) && <label>名称<input name="name" required maxLength={100} defaultValue={action === 'update_team' ? team?.name : ''} /></label>}
    {(action === 'create_team' || action === 'update_team') && <label>团队管理员<select name="leaderId" required defaultValue={action === 'update_team' ? team?.leaderId : ''}><option value="" disabled>请选择账号</option>{leaders.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}（{entry.loginName}）</option>)}</select><small>{leaders.length ? '新建团队使用未入团队账号；更换管理员也可选择本团队成员。' : '暂无可选账号，请先在账号管理中新增或启用账号。'}</small></label>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="org-actions"><button type="button" onClick={cancel}>取消</button><button className={deleting || (action === 'set_disabled' && !account?.disabled) ? 'danger-button' : 'primary-button'}>{pending ? '正在保存…' : deleting || action === 'set_disabled' ? '确认' + title : '保存'}</button></div>
  </fieldset></form>;
}
