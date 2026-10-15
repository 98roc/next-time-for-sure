import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { publicationPreviewSchema } from '@ntfs/contracts';
import type { OrganizationSnapshot, WeeklyPlanCommand } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { weekLabel } from '../layout/week-picker';
import { weeklyCommand } from './api';
import type { weeklySnapshot } from './api';
import { reportingRequest } from './reporting-api';
import { EffortSummary } from './publications';
import { PlanSummary } from './plan-summary';
import { planText, publicationPlanEntries } from './plan-view';

type Props = { data: Awaited<ReturnType<typeof weeklySnapshot>>; teamId: string; week: string; busy: boolean; csrf: string; organization: OrganizationSnapshot };

/** 汇总按任务聚合；当前草稿、历史副本及发布确认分开，失败时可重新核对范围。 */
export function PlanReview({ data, teamId, week, busy, csrf, organization }: Props) {
  const client = useQueryClient();
  const [source, setSource] = useState(data.canEdit ? 'draft' : 'published');
  const [versionId, setVersionId] = useState('');
  const [dialog, setDialog] = useState<'pending' | 'publish' | null>(null);

  const [message, setMessage] = useState('');
  const publication = data.publications.find((entry) => entry.id === versionId) ?? data.publications[0];
  const draft = data.canEdit && source === 'draft';
  const rows = draft ? data.draft?.rows ?? [] : publication?.rows ?? [];
  const preview = useMutation({ mutationFn: async () => publicationPreviewSchema.parse(await reportingRequest(`weekly-plans/preview?${new URLSearchParams({ teamId, week })}`)) });
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, csrf), onSuccess: async (_, command) => {
    await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    setDialog(null); setMessage(command.action === 'publish_plan' ? '计划已发布，原有历史版本保持不变。' : '待分配事项已加入草稿。');
  } });
  const pending = busy || save.isPending;
  function openPublish() { save.reset(); preview.reset(); setMessage(''); setDialog('publish'); preview.mutate(); }

  return <section className="plan-review">
    <div className="review-toolbar">
      <label className="review-source"><span className="sr-only">汇总来源</span><select value={draft ? 'draft' : 'published'} onChange={(event) => { setSource(event.target.value); setMessage(''); }}>{data.canEdit && <option value="draft">当前草稿</option>}<option value="published">已发布版本 · {data.publications.length}</option></select></label>
      {!draft && publication && <label className="review-version"><span className="sr-only">历史版本</span><select value={publication.id} onChange={(event) => { setVersionId(event.target.value); setMessage(''); }}>{data.publications.map((entry) => <option key={entry.id} value={entry.id}>第 {entry.revision} 版 · {new Date(entry.createdAt).toLocaleString('zh-CN')}</option>)}</select></label>}
      <div className="review-actions">

        <button className="text-button" disabled={!rows.length} onClick={() => { void navigator.clipboard.writeText(planText(publicationPlanEntries(rows, organization))).then(() => setMessage('已复制，任务按项目合并。'), () => setMessage('复制失败，请重试或手动选择内容。')); }}>复制汇总</button>
        {draft && data.canPublish && <><button className="text-button" disabled={pending} onClick={() => { save.reset(); setDialog('pending'); }}>＋ 待分配事项</button><button className="primary-button" disabled={pending || !data.draft} onClick={openPublish}>预览并发布</button></>}
      </div>
    </div>
    {!draft && <p className="review-context detail-meta">{publication ? `发布于 ${new Date(publication.createdAt).toLocaleString('zh-CN')} · 以下内容为所选版本，不随当前任务变化。` : '这一周还没有发布版本，可切换周次查看历史。'}</p>}
    {!draft && publication?.reason && <p className="review-reason">发布说明：{publication.reason}</p>}
    {message && <p role="status">{message}</p>}
    {(draft || publication) && <PlanSummary key={draft ? 'draft' : publication?.id} rows={rows} organization={organization} week={week} />}
    {rows.some((row) => row.plannedDays !== null) && <details className="review-effort"><summary>查看人员投入汇总</summary><EffortSummary rows={rows} /></details>}

    {dialog === 'pending' && <Dialog title={`添加${weekLabel(week)}待分配事项`} onClose={() => setDialog(null)} busy={pending}>
      <p className="detail-meta">用于还需要落实执行人员的任务；允许先纳入计划，稍后补充分工。</p>
      <form onSubmit={(event) => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get('task')); const task = data.pendingCandidates.find((entry) => entry.id === id); if (task) save.mutate({ action: 'add_pending', teamId, week, taskId: task.id, taskVersion: task.version }); }}><fieldset disabled={pending}><label>选择任务<select name="task" required><option value="">请选择任务</option>{data.pendingCandidates.filter((entry) => !data.draft?.pending.some((row) => row.taskId === entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label><div className="plan-edit-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-button">加入草稿</button></div></fieldset></form>
      {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    </Dialog>}
    {dialog === 'publish' && <Dialog title={`确认发布${weekLabel(week)}计划`} className="plan-publication-dialog" onClose={() => setDialog(null)} busy={pending}>
      <p className="detail-meta">以下是本次完整发布范围。发布不会删除旧版本；调整后需重新发布。</p>
      {preview.isPending && <p role="status">正在核对发布范围…</p>}
      {preview.error && <p className="form-error" role="alert">{preview.error.message}</p>}
      {preview.data && <><PlanSummary rows={preview.data.rows} organization={organization} week={week} /><form onSubmit={(event) => { event.preventDefault(); if (preview.data) save.mutate({ action: 'publish_plan', teamId, week, confirmation: preview.data.confirmation, reason: '' }); }}><fieldset disabled={pending || preview.isPending}><div className="plan-edit-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-button">确认发布</button></div></fieldset></form></>}
      {save.error && <p className="form-error" role="alert">{save.error.message} 请重新核对发布范围。</p>}
      {(preview.error || save.error) && <button disabled={pending || preview.isPending} onClick={() => { save.reset(); preview.mutate(); }}>重新核对范围</button>}
    </Dialog>}
  </section>;
}
