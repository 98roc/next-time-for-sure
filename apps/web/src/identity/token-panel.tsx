import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { issuedTokenSchema, personalTokensSchema, permanentTokenWarning } from '@ntfs/contracts';
import type { Identity } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { reportingRequest } from '../weekly-plans/reporting-api';

/** 令牌默认展示列表；创建与撤销独立确认，明文仅在当前组件内短暂保留。 */
export function TokenPanel({ identity }: { identity: Identity }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false); const [permanent, setPermanent] = useState(false);
  const [issued, setIssued] = useState(''); const [inputError, setInputError] = useState('');
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const list = useQuery({ queryKey: ['tokens', identity.id], queryFn: async () => personalTokensSchema.parse(await reportingRequest('tokens')) });
  const create = useMutation({
    mutationFn: async (input: object) => {
      const result = issuedTokenSchema.parse(await reportingRequest('tokens', input, identity.csrfToken));
      setIssued(result.token);
    },
    onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: ['tokens'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => reportingRequest('tokens/revoke', { id }, identity.csrfToken),
    onSuccess: async () => { setTarget(null); setIssued(''); await client.invalidateQueries({ queryKey: ['tokens'] }); },
  });
  return <div className="account-tokens"><header className="account-section-heading token-heading"><div><h2>Agent 访问令牌</h2><p>让外部 Agent 在你的当前权限范围内访问系统。</p></div><button className="primary-button" disabled={Boolean(issued) || creating} onClick={() => { setPermanent(false); setInputError(''); create.reset(); setCreating(true); }}>新建令牌</button></header>
    {list.isPending && <p role="status">正在加载令牌…</p>}
    {list.error && <p role="alert" className="form-error">{list.error.message}<button onClick={() => { void list.refetch(); }}>重试</button></p>}
    {issued && <section className="issued-token" aria-label="新令牌"><h3>令牌已生成，请妥善保存</h3><p>完整值只显示这一次。切换设置项或离开页面后将无法再次查看。</p><label>新令牌<textarea readOnly value={issued} spellCheck={false} autoComplete="off" onFocus={(event) => event.currentTarget.select()} /></label><button onClick={() => setIssued('')}>已保存，隐藏令牌</button></section>}
    {list.data?.length === 0 && <div className="token-empty"><h3>还没有访问令牌</h3><p>需要连接 Codex 等外部 Agent 时，再创建一个。</p></div>}
    <div className="token-list">{list.data?.map((entry) => {
      const expired = Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now());
      return <article className="token-row" key={entry.id}><div><h3>{entry.name}<span className="account-badge">{entry.revokedAt ? '已撤销' : expired ? '已过期' : '有效'}</span></h3><p>{entry.expiresAt ? '到期时间：' + new Date(entry.expiresAt).toLocaleString('zh-CN') : '永久有效'}</p></div>{!entry.revokedAt && <button onClick={() => { revoke.reset(); setTarget({ id: entry.id, name: entry.name }); }}>撤销</button>}</article>;
    })}</div>
    {creating && <Dialog title="新建访问令牌" busy={create.isPending} onClose={() => setCreating(false)}><form onSubmit={(event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const expiry = new Date(String(form.get('expiresAt')));
      if (!permanent && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) { setInputError('请选择未来的到期时间。'); return; }
      setInputError(''); create.mutate({ name: String(form.get('name')), expiresAt: permanent ? null : expiry.toISOString(), permanentConfirmed: form.get('permanentConfirmed') === 'on' });
    }}><fieldset disabled={create.isPending}><label>用途名称<input name="name" required maxLength={100} placeholder="例如：办公电脑 Codex" /></label><label>有效期<select value={permanent ? 'permanent' : 'expiry'} onChange={(event) => setPermanent(event.target.value === 'permanent')}><option value="expiry">指定到期时间</option><option value="permanent">永久有效</option></select></label>{permanent ? <label><input name="permanentConfirmed" type="checkbox" required />{permanentTokenWarning}</label> : <label>到期时间<input name="expiresAt" type="datetime-local" required /></label>}
      {(create.error || inputError) && <p role="alert" className="form-error">{inputError || create.error?.message}</p>}
      <div className="account-form-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button className="primary-button">{create.isPending ? '正在生成…' : '生成令牌'}</button></div>
    </fieldset></form></Dialog>}
    {target && <Dialog title="撤销访问令牌" busy={revoke.isPending} onClose={() => setTarget(null)}><p>确认撤销“{target.name}”？使用它的 Agent 将无法继续访问系统，此操作不能恢复。</p>{revoke.error && <p role="alert" className="form-error">{revoke.error.message}</p>}<div className="account-form-actions"><button disabled={revoke.isPending} onClick={() => setTarget(null)}>取消</button><button disabled={revoke.isPending} onClick={() => revoke.mutate(target.id)}>{revoke.isPending ? '正在撤销…' : '确认撤销'}</button></div></Dialog>}
  </div>;
}
