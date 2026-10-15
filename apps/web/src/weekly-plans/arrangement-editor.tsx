import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weeklyPlanCommandSchema } from '@ntfs/contracts';
import type { Identity, WeeklyPlanCommand } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { weekLabel } from '../layout/week-picker';
import { ArrangementFields, arrangementValues } from './arrangement-fields';
import { weeklyCommand, weeklySnapshot } from './api';

/** 编辑指定周的同一条分工；继续到后一周时先回读目标内容，不修改来源周。 */
export function WeeklyArrangementEditor({ teamId, week, sourceWeek, assignmentId, identity, onClose }: {
  teamId: string; week: string; sourceWeek: string; assignmentId: string; identity: Identity; onClose: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const state = useQuery({ queryKey: ['weekly', identity.id, teamId, week], queryFn: () => weeklySnapshot(teamId, week), retry: false });
  const candidate = state.isError ? undefined : state.data?.candidates.find((entry) => entry.assignmentId === assignmentId);
  const arrangement = state.data?.draft?.arrangements.find((entry) => entry.assignmentId === assignmentId);
  const save = useMutation({ mutationFn: (command: WeeklyPlanCommand) => weeklyCommand(command, identity.csrfToken), onSuccess: async () => {
    await Promise.all(['weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    onClose();
  } });
  return <Dialog title={`${weekLabel(week)}安排${candidate ? ` · ${candidate.taskTitle}` : ''}`} onClose={onClose} busy={save.isPending}>
    {week !== sourceWeek && <p className="inline-notice">保留{weekLabel(sourceWeek)}安排，继续安排{weekLabel(week)}。若目标周已有内容，以下展示已有安排，请核对后保存。</p>}
    {state.isFetching && <p role="status">正在读取安排…</p>}
    {!state.isFetching && !state.isError && !candidate && <p>分工已停止或不在当前可安排范围内，请关闭后刷新核对。</p>}
    {candidate && <><p>{candidate.displayName} · {candidate.groupName}{candidate.content && ` · ${candidate.content}`}</p>
      <form key={`${arrangement?.id ?? 'new'}:${arrangement?.version ?? ''}`} onSubmit={(event) => {
        event.preventDefault();
        const parsed = weeklyPlanCommandSchema.safeParse({ action: 'save_arrangement', teamId, week, assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: arrangement?.version ?? null, ...arrangementValues(event.currentTarget) });
        if (!parsed.success) { setError('请核对目标、进度与投入；投入最多两位小数。'); return; }
        setError(''); save.mutate(parsed.data);
      }}><fieldset disabled={save.isPending || state.isFetching}>
        <ArrangementFields week={week} arrangement={arrangement} />
        <div className="plan-edit-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button">保存{weekLabel(week)}安排</button></div>
      </fieldset></form>
    </>}
    {(error || save.error || state.error) && <p className="form-error" role="alert">{error || save.error?.message || state.error?.message}<button disabled={save.isPending} onClick={() => { void state.refetch(); }}>刷新核对</button></p>}
  </Dialog>;
}
