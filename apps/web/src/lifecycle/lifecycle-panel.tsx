import { createOperationId } from '../identity/operation-id';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lifecyclePreviewSchema } from '@ntfs/contracts';
import type { LifecycleIntent, Identity } from '@ntfs/contracts';
import { reportingRequest } from '../weekly-plans/reporting-api';
import { Dialog } from '../layout/dialog';
import './lifecycle.css';

/** 高影响操作统一先展示范围和阻止原因，再提交绑定摘要的确认。 */
export function LifecyclePanel({ identity, options, initialIntent, onClose }: { identity: Identity; options: Array<{ label: string; intent: LifecycleIntent }>; initialIntent?: LifecycleIntent; onClose?: () => void }) {
  const [selected, setSelected] = useState<number | null>(null); const client = useQueryClient();
  const [key, setKey] = useState(() => createOperationId());
  const preview = useMutation({ mutationFn: async (intent: LifecycleIntent) => lifecyclePreviewSchema.parse(await reportingRequest('lifecycle/preview', intent, identity.csrfToken)) });
  const execute = useMutation({ mutationFn: (body: object) => reportingRequest('lifecycle/commands', body, identity.csrfToken), onSuccess: async () => { setSelected(null); preview.reset(); setKey(createOperationId()); await Promise.all(['work', 'personal', 'organization', 'assignments', 'weekly', 'reports', 'handoff', 'lifecycle-history', 'overview', 'notifications'].map((queryKey) => client.invalidateQueries({ queryKey: [queryKey] }))); onClose?.(); } });
  const loadPreview = preview.mutate;
  // 卡片快捷入口直接读取影响范围，与详情入口共用确认和并发校验。
  useEffect(() => { if (initialIntent) loadPreview(initialIntent); }, [initialIntent, loadPreview]);
  const option = initialIntent ? options.find((entry) => entry.intent.action === initialIntent.action) : selected === null ? undefined : options[selected]; const busy = preview.isPending || execute.isPending;
  const deleting = option?.intent.action === 'delete_task' || option?.intent.action === 'delete_personal';
  const review = preview.data;
  const subject = review?.title.replace(/^(删除任务|删除个人事项)：/, '');
  function cancel() { setSelected(null); preview.reset(); onClose?.(); }
  const content = <>
    {preview.isPending && <p role="status">正在检查影响范围…</p>}
    {!initialIntent && <div className="weekly-toolbar">{options.map((entry, index) => <button key={JSON.stringify(entry.intent)} disabled={busy} onClick={() => { setSelected(index); setKey(createOperationId()); execute.reset(); preview.mutate(entry.intent); }}>{entry.label}…</button>)}</div>}
    {(preview.error || execute.error) && <p role="alert" className="form-error">{preview.error?.message || execute.error?.message}</p>}{execute.isSuccess && <p role="status">操作已完成。</p>}
    {option && review && !preview.isPending && <form className="lifecycle-confirmation" onSubmit={(event) => {
      event.preventDefault();
      if (busy || review.blockers.length) return;
      execute.mutate({ intent: option.intent, confirmation: review.confirmation, reason: deleting ? undefined : String(new FormData(event.currentTarget).get('reason')), operationId: key });
    }}>
      <p className="lifecycle-subject">{deleting ? <>确定删除「<strong>{subject}</strong>」？</> : <strong>{review.title}</strong>}</p>
      <div className="lifecycle-impacts">{review.impacts.map((entry) => <p key={entry}>{entry}</p>)}</div>
      {review.blockers.length > 0 ? <div className="lifecycle-blockers"><p>{deleting ? '暂时无法删除' : '请先处理以下事项'}</p><ul>{review.blockers.map((entry) => <li key={entry}>{entry}</li>)}</ul></div> : !deleting && <label>操作原因<textarea required name="reason" maxLength={2000} /></label>}
      <div className="lifecycle-actions"><button type="button" disabled={busy} onClick={cancel}>取消</button>{!review.blockers.length && <button type="submit" disabled={busy} className={deleting ? 'lifecycle-delete-button' : 'primary-button'}>{execute.isPending ? '正在处理…' : deleting ? '删除' : `确认${option.label}`}</button>}</div>
    </form>}
  </>;
  return onClose ? <Dialog className="lifecycle-dialog" title={option?.label ?? '操作确认'} busy={busy} onClose={onClose}>{content}</Dialog> : <details><summary>生命周期与归属管理</summary>{content}</details>;
}
