import { weekLabel } from '../layout/week-picker';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { publicationPreviewSchema } from '@ntfs/contracts';
import type { WeeklyPlanCommand } from '@ntfs/contracts';
import type { weeklySnapshot } from './api';
import { reportingRequest } from './reporting-api';
import { EffortSummary, Publications } from './publications';
/** 将独立任务／分工状态转换成页面业务文字。 */
function statusText(status: string) { const labels: Record<string, string> = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消', transferred: '已转交', exited: '已退出' }; return status.split('/').map((part) => labels[part] ?? part).join(' / '); }

/** 草稿全貌、删除、待分配及发布确认集中展示，旧发布记录始终独立。 */
export function PlanReview({ data, teamId, week, busy, send }: { data: Awaited<ReturnType<typeof weeklySnapshot>>; teamId: string; week: string; busy: boolean; send: (command: WeeklyPlanCommand) => void }) {
  const [confirmation, setConfirmation] = useState('');
  const preview = useMutation({ mutationFn: async () => publicationPreviewSchema.parse(await reportingRequest(`weekly-plans/preview?${new URLSearchParams({ teamId, week })}`)), onSuccess: (result) => setConfirmation(result.confirmation) });
  return <>
    {data.draft && <><EffortSummary rows={data.draft.rows} /><section className="weekly-section collection-section"><h2>{weekLabel(week)}已安排事项</h2>{data.draft.rows.map((row) => {
      const arrangement = data.draft?.arrangements.find((entry) => row.sourceIds.includes(entry.assignmentId)); const pending = data.draft?.pending.find((entry) => row.sourceIds.includes(entry.id));
      return <article className="weekly-entry" key={row.sourceIds.join(':')}><h3>{row.projectName} · {row.title}</h3><p>{[row.person, row.text, row.plannedDays === null ? '' : `${row.plannedDays} 天`].filter(Boolean).join(' · ')}</p><p>执行状态：{statusText(row.status)}</p>{data.canEdit && <button disabled={busy} onClick={() => { if (arrangement) send({ action: 'remove_arrangement', teamId, week, arrangementId: arrangement.id, version: arrangement.version }); else if (pending) send({ action: 'remove_pending', teamId, week, pendingId: pending.id, version: pending.version }); }}>移出{weekLabel(week)}草稿</button>}</article>;
    })}</section></>}
    {data.canPublish && <section className="panel weekly-section"><h2>待分配与发布</h2><form onSubmit={(event) => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get('task')); const task = data.pendingCandidates.find((entry) => entry.id === id); if (task) send({ action: 'add_pending', teamId, week, taskId: task.id, taskVersion: task.version }); }}><label>仍需落实人员的事项<select name="task" required><option value="">选择任务</option>{data.pendingCandidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label><button disabled={busy || !data.pendingCandidates.length}>作为待分配加入{weekLabel(week)}</button></form><p>待分配事项允许发布，投入留空不会阻止发布。</p>
      <button className="primary-button" disabled={busy || preview.isPending || !data.draft} onClick={() => preview.mutate()}>预览计划发布范围</button>{preview.error && <p className="form-error" role="alert">{preview.error.message}</p>}
      {confirmation && preview.data && <form onSubmit={(event) => { event.preventDefault(); send({ action: 'publish_plan', teamId, week, confirmation, reason: String(new FormData(event.currentTarget).get('reason')) }); setConfirmation(''); }}><h3>确认发布 {preview.data.rows.length} 条安排</h3><ul>{preview.data.rows.map((row) => <li key={row.sourceIds.join(':')}>{[row.projectName, row.title, row.person, row.text, row.plannedDays === null ? '' : `${row.plannedDays} 天`].filter(Boolean).join(' · ')}</li>)}</ul><label>发布／调整说明<textarea name="reason" required maxLength={2000} /></label><button className="primary-button" disabled={busy}>确认发布计划</button><button type="button" onClick={() => setConfirmation('')}>取消</button></form>}
    </section>}
    <Publications versions={data.publications} />
  </>;
}
