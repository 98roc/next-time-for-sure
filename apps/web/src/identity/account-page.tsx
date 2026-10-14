import { Brand } from '../layout/app-shell';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePassword, currentIdentity, login, logout } from './api';
import './identity.css';
import { TokenPanel } from './token-panel';

/** 身份入口：未登录时展示登录表单，已登录时提供本人改密与退出。 */
export function AccountPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [section, setSection] = useState('password');
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [replacement, setReplacement] = useState('');
  const [notice, setNotice] = useState('');
  const action = useMutation({
    mutationFn: async (type: 'login' | 'password' | 'logout') => {
      if (type === 'login') return login(loginName, password);
      if (!identity.data) throw new Error('请先登录。');
      if (type === 'password') await changePassword(password, replacement, identity.data.csrfToken);
      else await logout(identity.data.csrfToken);
      return null;
    },
    onSuccess: (result, type) => {
      client.clear();
      client.setQueryData(['identity'], result);
      setPassword(''); setReplacement('');
      if (type === 'login' && result && !result.mustChangePassword) { const next = params.get('returnTo'); navigate(next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/account') ? next : result.isSuperAdmin ? '/organization' : '/personal', { replace: true }); }
      setNotice(type === 'password' ? '密码已修改，所有旧会话已撤销，请重新登录。' : type === 'logout' ? '已退出登录。' : '');
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); action.mutate(identity.data ? 'password' : 'login'); }

  return <div className="identity-layout"><div className="identity-brand"><Link to="/personal"><Brand /></Link></div><main className="identity-card panel">
    <p className="eyebrow">账号与安全</p><h1>{identity.data ? `你好，${identity.data.displayName}` : '登录工作空间'}</h1>
    {identity.isPending ? <p role="status">正在检查登录状态…</p> : identity.isError ? <div role="alert"><p>服务暂时不可用，请检查后重试。</p><button onClick={() => { void identity.refetch(); }}>重新连接</button></div> : <>
      {identity.data && <p className="subtitle">{identity.data.mustChangePassword ? '首次登录请先修改临时密码。' : '修改密码后，所有设备需要重新登录。'}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {identity.data && !identity.data.mustChangePassword && <div className="view-tabs"><button aria-pressed={section === 'password'} onClick={() => setSection('password')}>密码</button><button aria-pressed={section === 'tokens'} onClick={() => setSection('tokens')}>Agent 访问令牌</button></div>}
      {(!identity.data || identity.data.mustChangePassword || section === 'password') && <form onSubmit={submit}>
        {!identity.data && <label>账号<input name="username" autoComplete="username" required maxLength={64} value={loginName} onChange={(event) => setLoginName(event.target.value)} /></label>}
        <label>{identity.data ? '当前密码' : '密码'}<input name="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {identity.data && <label>新密码<input name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={replacement} onChange={(event) => setReplacement(event.target.value)} /><small>12～128个字符</small></label>}
        {action.isError && <p className="form-error" role="alert">{action.error.message}</p>}
        <button className="primary-button" disabled={action.isPending}>{action.isPending ? '正在处理…' : identity.data ? '修改密码并重新登录' : '登录'}</button>
      </form>}
      {identity.data && <button className="text-button" disabled={action.isPending} onClick={() => action.mutate('logout')}>退出登录</button>}
      {!identity.data && <p className="footnote">账号由管理员创建，不开放自行注册。忘记密码请联系团队管理员。</p>}
    </>}
    <Link className="status-link" to="/personal">← 返回工作空间</Link>
    {identity.data && !identity.data.mustChangePassword && section === 'tokens' && <TokenPanel key={identity.data.id} identity={identity.data} />}
  </main></div>;
}
