import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lifecyclePreviewSchema } from '@ntfs/contracts';
import type { LifecycleIntent, Identity } from '@ntfs/contracts';
import { reportingRequest } from '../weekly-plans/reporting-api';

/** 高影响操作统一先展示范围和阻止原因，再提交绑定摘要的确认。 */
export function LifecyclePanel({ identity, options }: { identity: Identity; options: Array<{ label: string; intent: LifecycleIntent }> }) {
  const [selected, setSelected] = useState<number | null>(null); const client = useQueryClient();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const preview = useMutation({ mutationFn: async (intent: LifecycleIntent) => lifecyclePreviewSchema.parse(await reportingRequest('lifecycle/preview', intent, identity.csrfToken)) });
  const execute = useMutation({ mutationFn: (body: object) => reportingRequest('lifecycle/commands', body, identity.csrfToken), onSuccess: async () => { setSelected(null); preview.reset(); setKey(crypto.randomUUID()); await Promise.all(['work', 'personal', 'organization', 'assignments', 'weekly', 'reports', 'handoff', 'lifecycle-history', 'overview', 'notifications'].map((queryKey) => client.invalidateQueries({ queryKey: [queryKey] }))); } });
  const option = selected === null ? undefined : options[selected]; const busy = preview.isPending || execute.isPending;
  return <details><summary>生命周期与归属管理</summary><div className="weekly-toolbar">{options.map((entry, index) => <button key={JSON.stringify(entry.intent)} disabled={busy} onClick={() => { setSelected(index); setKey(crypto.randomUUID()); execute.reset(); preview.mutate(entry.intent); }}>{entry.label}…</button>)}</div>
    {(preview.error || execute.error) && <p role="alert" className="form-error">{preview.error?.message || execute.error?.message}</p>}{execute.isSuccess && <p role="status">操作已完成。</p>}
    {option && preview.data && !preview.isPending && <section className="weekly-entry"><h3>{preview.data.title}</h3><ul>{preview.data.impacts.map((entry) => <li key={entry}>{entry}</li>)}</ul>{preview.data.blockers.length > 0 ? <><p>请先处理：</p><ul>{preview.data.blockers.map((entry) => <li key={entry}>{entry}</li>)}</ul></> : <form onSubmit={(event) => { event.preventDefault(); execute.mutate({ intent: option.intent, confirmation: preview.data?.confirmation, reason: String(new FormData(event.currentTarget).get('reason')), operationId: key }); }}><label>操作原因<textarea required name="reason" maxLength={2000} /></label><button disabled={busy} className="primary-button">确认{option.label}</button></form>}<button disabled={busy} onClick={() => { setSelected(null); preview.reset(); }}>取消</button></section>}
  </details>;
}
