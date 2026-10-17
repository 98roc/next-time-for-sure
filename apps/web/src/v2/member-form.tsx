import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { organizationCommandSchema, passwordHint, passwordSchema, type Identity, type OrganizationSnapshot } from '@ntfs/contracts';
import { organizationCommand } from '../organization/api';
import { PasswordField } from '../identity/password-field';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';

export type AccountAction = 'create_member' | 'link_member' | 'reset_password' | 'set_disabled' | 'create_account' | 'update_account' | 'delete_account' | 'create_team' | 'update_team' | 'delete_team';
const labels: Record<AccountAction, string> = { create_member: '创建成员账号', link_member: '添加已有账号', reset_password: '重置密码', set_disabled: '修改账号状态', create_account: '新增账号', update_account: '编辑账号', delete_account: '删除账号', create_team: '新增团队', update_team: '编辑团队', delete_team: '删除团队' };

/** 账号安全与超管基础维护保留，使用统一弹窗，不夹带小组、交接或项目任务字段。 */
export function AccountForm({ action: kind, user, accounts, teams, accountId, teamId }: { action: AccountAction; user: Identity; accounts: OrganizationSnapshot['accounts']; teams: OrganizationSnapshot['teams']; accountId?: string; teamId?: string }) {
  const action = useAction(), modal = useModal(), client = useQueryClient(), formId = useId();
  const account = accounts.find((row) => row.id === accountId), team = teams.find((row) => row.id === teamId);
  const [loginName, setLogin] = useState(account?.loginName ?? ''), [displayName, setDisplay] = useState(account?.displayName ?? ''), [password, setPassword] = useState(''), [name, setName] = useState(team?.name ?? ''), [leaderId, setLeader] = useState(team?.leaderId ?? '');
  const creates = kind === 'create_account' || kind === 'create_member', teamForm = kind === 'create_team' || kind === 'update_team';
  const title = kind === 'set_disabled' ? account?.disabled ? '启用账号' : '停用账号' : labels[kind];
  const dirty = loginName !== (account?.loginName ?? '') || displayName !== (account?.displayName ?? '') || password !== '' || name !== (team?.name ?? '') || leaderId !== (team?.leaderId ?? '');
  async function submit() {
    let input: unknown;
    if (creates) input = { action: kind, loginName, displayName, password, ...(kind === 'create_member' ? { teamId } : {}) };
    else if (kind === 'link_member') input = { action: kind, teamId, loginName };
    else if (kind === 'reset_password') input = { action: kind, accountId, version: account?.version, password };
    else if (kind === 'set_disabled') input = { action: kind, accountId, version: account?.version, disabled: !account?.disabled };
    else if (kind === 'update_account') input = { action: kind, accountId, version: account?.version, loginName, displayName };
    else if (kind === 'delete_account') input = { action: kind, accountId, version: account?.version };
    else if (kind === 'create_team') input = { action: kind, name, leaderId };
    else if (kind === 'update_team') input = { action: kind, teamId, version: team?.version, name, leaderId };
    else input = { action: kind, teamId, version: team?.version };
    if ((creates || kind === 'reset_password') && !passwordSchema.safeParse(password).success) throw new Error(passwordHint);
    const parsed = organizationCommandSchema.safeParse(input); if (!parsed.success) throw new Error('请补全有效账号、姓名和必填信息。');
    await organizationCommand(parsed.data, user.csrfToken); setPassword('');
    await Promise.all([client.invalidateQueries({ queryKey: ['v2'] }), client.invalidateQueries({ queryKey: ['organization'] }), client.invalidateQueries({ queryKey: ['identity'] })]);
    modal.finish();
  }
  return <ModalPage title={title} busy={action.busy} dirty={dirty} actions={<button className={kind.startsWith('delete') || (kind === 'set_disabled' && !account?.disabled) ? 'v2-danger' : 'nt-primary'} type="submit" form={formId} disabled={action.busy}>{kind.startsWith('delete') || kind === 'set_disabled' ? title : '保存'}</button>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); void action.act(submit); }}><fieldset disabled={action.busy}><div className="v2-fields">
      {account && !creates && <p className="v2-full">账号：{account.displayName}（{account.loginName}）</p>}
      {kind === 'set_disabled' && <p className="v2-full">{account?.disabled ? '启用后可以重新登录，原会话不会恢复。' : '停用后立即撤销登录与 Agent 访问，任务、里程碑和历史保留，不自动转交。'}</p>}
      {kind === 'delete_account' && <p className="v2-full">删除账号仅适用于无团队及工作历史的账号；已有工作记录请使用停用。</p>}
      {kind === 'delete_team' && <p className="v2-full">删除团队“{team?.name}”，仅无其他成员、项目和业务历史时可删除，负责人账号保留。</p>}
      {(creates || kind === 'link_member' || kind === 'update_account') && <Field label="登录账号"><input required minLength={3} maxLength={64} autoComplete="off" value={loginName} onChange={(event) => setLogin(event.target.value)} /></Field>}
      {(creates || kind === 'update_account') && <Field label="姓名"><input required maxLength={100} value={displayName} onChange={(event) => setDisplay(event.target.value)} /></Field>}
      {(creates || kind === 'reset_password') && <div className="v2-full"><PasswordField label="临时密码" value={password} onChange={setPassword} autoComplete="new-password" hint={`${passwordHint}首次登录必须修改。`} /></div>}
      {kind === 'link_member' && <p className="v2-context v2-full">账号须已启用且未加入其他团队。</p>}
      {teamForm && <><Field label="团队名称"><input required value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></Field><Field label="团队负责人"><select required value={leaderId} onChange={(event) => setLeader(event.target.value)}><option value="">请选择账号</option>{accounts.filter((row) => !row.disabled && (!row.teamId || (kind === 'update_team' && row.teamId === teamId))).map((row) => <option key={row.id} value={row.id}>{row.displayName}（{row.loginName}）</option>)}</select></Field></>}
    </div><Feedback error={action.error} /></fieldset></form>
  </ModalPage>;
}
