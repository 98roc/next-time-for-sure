import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { issuedTokenSchema, personalTokensSchema, permanentTokenWarning } from '@ntfs/contracts';
import type { Identity } from '@ntfs/contracts';
import { reportingRequest } from '../weekly-plans/reporting-api';

/** Token只在生成响应中展示，离开页面即清除明文，不存浏览器缓存。 */
export function TokenPanel({ identity }: { identity: Identity }) {
  const client = useQueryClient(); const [permanent, setPermanent] = useState(false); const [issued, setIssued] = useState('');
  const list = useQuery({ queryKey: ['tokens', identity.id], queryFn: async () => personalTokensSchema.parse(await reportingRequest('tokens')) });
  const create = useMutation({ mutationFn: async (input: object) => { const result = issuedTokenSchema.parse(await reportingRequest('tokens', input, identity.csrfToken)); setIssued(result.token); }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['tokens'] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => reportingRequest('tokens/revoke', { id }, identity.csrfToken), onSuccess: async () => { setIssued(''); await client.invalidateQueries({ queryKey: ['tokens'] }); } });
  return <section><h2>个人访问 Token</h2><p>供外部 Agent 使用，权限随当前账号实时变化。仅在生成时显示完整值。</p><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setIssued(''); create.mutate({ name: String(form.get('name')), expiresAt: permanent ? null : new Date(String(form.get('expiresAt'))).toISOString(), permanentConfirmed: form.get('permanentConfirmed') === 'on' }); }}><fieldset disabled={create.isPending}><label>用途名称<input name="name" required maxLength={100} /></label><label>有效期<select value={permanent ? 'permanent' : 'expiry'} onChange={(event) => setPermanent(event.target.value === 'permanent')}><option value="expiry">指定到期时间</option><option value="permanent">永久有效</option></select></label>{permanent ? <label><input name="permanentConfirmed" type="checkbox" required />{permanentTokenWarning}</label> : <label>到期时间<input name="expiresAt" type="datetime-local" required /></label>}<button>生成 Token</button></fieldset></form>
    {(create.error || revoke.error || list.error) && <p role="alert" className="form-error">{create.error?.message || revoke.error?.message || list.error?.message}</p>}
    {issued && <div role="status"><p>请立即保存到本地私有配置；关闭后无法再次查看。</p><label>新 Token<textarea readOnly value={issued} spellCheck={false} /></label><button onClick={() => setIssued('')}>已保存，隐藏明文</button></div>}
    {list.data?.map((entry) => <article key={entry.id}><h3>{entry.name}</h3><p>{entry.revokedAt ? '已撤销' : entry.expiresAt ? `到期：${new Date(entry.expiresAt).toLocaleString('zh-CN')}` : '永久有效'}</p>{!entry.revokedAt && <button disabled={revoke.isPending} onClick={() => revoke.mutate(entry.id)}>撤销此 Token</button>}</article>)}
  </section>;
}
