import { useState } from 'react';
import { passwordHint, passwordSchema } from '@ntfs/contracts';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand } from '../layout/app-shell';
import { changePassword, currentIdentity, login, logout } from './api';
import { PasswordField } from './password-field';
import { TokenPanel } from './token-panel';
import './identity.css';

type AccountAction = { type: 'login'; loginName: string; password: string } | { type: 'password'; current: string; replacement: string } | { type: 'logout' };

/** 登录与设置分开呈现；强制改密完成前不提供业务返回或Token入口。 */
export function AccountPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const [section, setSection] = useState<'password' | 'tokens'>('password');
  const [notice, setNotice] = useState('');
  const action = useMutation({
    mutationFn: async (input: AccountAction) => {
      if (input.type === 'login') return login(input.loginName, input.password);
      if (!identity.data) throw new Error('请先登录。');
      if (input.type === 'password') await changePassword(input.current, input.replacement, identity.data.csrfToken);
      else await logout(identity.data.csrfToken);
      return null;
    },
    onSuccess: (result, input) => {
      // 身份变化时清除旧账号的业务查询；改密撤销会话后回到登录表单。
      client.clear(); client.setQueryData(['identity'], result);
      setSection('password');
      setNotice(input.type === 'password' ? '密码已修改，请使用新密码重新登录。' : input.type === 'logout' ? '已退出登录。' : '');
      if (input.type === 'login' && result && !result.mustChangePassword) {
        const next = params.get('returnTo');
        const allowed = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && next.split('?')[0] !== '/account';
        navigate(allowed ? next : result.isSuperAdmin ? '/accounts' : '/personal', { replace: true });
      }
    },
  });
  const user = identity.data;
  const back = user?.isSuperAdmin ? '/accounts' : '/personal';
  const feedback = <>{notice && <p role="status" className="account-notice">{notice}</p>}{action.error && <p role="alert" className="form-error account-notice">{action.error.message}</p>}</>;

  if (identity.isPending || identity.isError) return <div className="identity-layout"><header className="identity-brand"><Brand /></header><main className="identity-card panel">{identity.isPending ? <p role="status">正在检查登录状态…</p> : <div role="alert"><p>暂时无法连接服务。</p><button onClick={() => { void identity.refetch(); }}>重新连接</button></div>}</main></div>;
  if (!user) return <div className="identity-layout"><header className="identity-brand"><Brand /></header><main className="identity-card panel"><h1>登录工作空间</h1><p className="subtitle">下次一定，从这次开始。</p>{feedback}<LoginForm pending={action.isPending} submit={(loginName, password) => action.mutate({ type: 'login', loginName, password })} /><p className="footnote">账号由管理员创建。忘记密码请联系管理员。</p></main></div>;

  return <div className="identity-layout account-settings"><header className="account-topbar"><Brand />{!user.mustChangePassword && <Link to={back}>← 返回{user.isSuperAdmin ? '系统管理' : '工作空间'}</Link>}</header>
    <main className="account-container" aria-label="账号设置">
      <section className="account-profile"><span className="account-avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span><div><h2>{user.displayName}</h2><p>登录账号：{user.loginName}</p></div><span className="account-badge">{user.isSuperAdmin ? '系统管理员' : '个人账号'}</span></section>
      <div className="account-grid"><aside className="account-navigation"><nav aria-label="账号设置分类"><button aria-current={section === 'password' ? 'page' : undefined} disabled={action.isPending} onClick={() => { setSection('password'); action.reset(); }}>登录密码<span>修改密码，保护账号</span></button>{!user.mustChangePassword && <button aria-current={section === 'tokens' ? 'page' : undefined} disabled={action.isPending} onClick={() => { setSection('tokens'); action.reset(); }}>Agent 访问令牌<span>连接外部 Agent</span></button>}</nav><div className="account-session"><span>当前登录会话</span><button disabled={action.isPending} onClick={() => action.mutate({ type: 'logout' })}>退出登录</button></div></aside>
        <section className="account-content" aria-label={section === 'password' ? '登录密码' : 'Agent 访问令牌'}>{feedback}{user.mustChangePassword || section === 'password' ? <><header className="account-section-heading"><h2>{user.mustChangePassword ? '设置你的登录密码' : '修改登录密码'}</h2><p>{user.mustChangePassword ? '首次登录，请先将临时密码修改为你自己的密码。' : '使用与其他平台不同的密码，降低账号泄露风险。'}</p></header><PasswordForm pending={action.isPending} submit={(current, replacement) => action.mutate({ type: 'password', current, replacement })} /></> : <TokenPanel key={user.id} identity={user} />}</section>
      </div>
    </main>
  </div>;
}

/** 登录表单只保存当前输入；提交期间禁用编辑，防止重复登录。 */
function LoginForm({ pending, submit }: { pending: boolean; submit: (loginName: string, password: string) => void }) {
  const [loginName, setLoginName] = useState(''); const [password, setPassword] = useState('');
  return <form onSubmit={(event) => { event.preventDefault(); submit(loginName, password); }}><fieldset disabled={pending}><label>账号<input name="username" autoComplete="username" required maxLength={64} value={loginName} onChange={(event) => setLoginName(event.target.value)} /></label><PasswordField label="密码" value={password} onChange={setPassword} autoComplete="current-password" /><button className="primary-button">{pending ? '正在登录…' : '登录'}</button></fieldset></form>;
}

/** 提交前核对两次新密码及新旧差异；字段错误保留输入供修正，取消清空全部密码。 */
function PasswordForm({ pending, submit }: { pending: boolean; submit: (current: string, replacement: string) => void }) {
  const [current, setCurrent] = useState(''); const [replacement, setReplacement] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [checked, setChecked] = useState(false);
  const mismatch = confirmation !== replacement;
  const unchanged = current === replacement;
  const invalidPassword = !passwordSchema.safeParse(replacement).success;
  const error = checked ? invalidPassword ? passwordHint : unchanged ? '新密码不能与当前密码相同。' : mismatch ? '两次输入的新密码不一致，请重新确认。' : '' : '';
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setChecked(true);
    if (!invalidPassword && !unchanged && !mismatch) submit(current, replacement);
  }
  return <form className="account-password-form" onSubmit={send}><fieldset disabled={pending}>
    <PasswordField label="当前密码" value={current} onChange={setCurrent} autoComplete="current-password" />
    <PasswordField label="新密码" value={replacement} onChange={setReplacement} autoComplete="new-password" hint={passwordHint + '不能与当前密码相同。'} invalid={checked && (invalidPassword || unchanged)} />
    <PasswordField label="确认新密码" value={confirmation} onChange={setConfirmation} autoComplete="new-password" invalid={checked && mismatch} />
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="account-security-note">修改成功后，所有设备的登录会话将失效，需要重新登录。</p>
    <div className="account-form-actions"><button className="primary-button">{pending ? '正在更新…' : '更新密码'}</button><button type="button" disabled={!current && !replacement && !confirmation} onClick={() => { setCurrent(''); setReplacement(''); setConfirmation(''); setChecked(false); }}>取消修改</button></div>
  </fieldset></form>;
}
