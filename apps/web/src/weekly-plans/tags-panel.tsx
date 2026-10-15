import { weekStart } from '../layout/week-picker';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagStateSchema, tagCommandSchema } from '@ntfs/contracts';
import type { TagCommand } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { currentWeek, reportingRequest } from './reporting-api';
import './weekly.css';

/** 仅显式人工标记展示计划外；未标记不显示为计划内。 */
export function TagsPanel({ objectId, objectKind, expanded = false, initialWeek }: { objectId: string; objectKind: 'task' | 'personal'; expanded?: boolean; initialWeek?: string | undefined }) {
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity }); const client = useQueryClient();
  const [week, setWeek] = useState(initialWeek ?? currentWeek()); const [error, setError] = useState('');
  const state = useQuery({ queryKey: ['tags', identity.data?.id, objectId], queryFn: async () => tagStateSchema.parse(await reportingRequest(`work-tags?${new URLSearchParams({ objectId, objectKind })}`)), retry: false });
  const save = useMutation({ mutationFn: (body: TagCommand) => reportingRequest('work-tags/commands', body, identity.data?.csrfToken), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['tags'] }); } });
  const data = state.isError ? undefined : state.data;
  function toggle(dimension: 'milestone' | 'weekly') {
    const old = data?.tags.find((entry) => entry.dimension === dimension && entry.week === (dimension === 'weekly' ? week : ''));
    const parsed = tagCommandSchema.safeParse({ objectId, objectKind, dimension, week: dimension === 'weekly' ? week : null, marked: !old?.marked, version: old?.version ?? null });
    if (!parsed.success) { setError('周计划标签请选择周一日期。'); return; } setError(''); save.mutate(parsed.data);
  }
  const Wrapper = expanded ? 'section' : 'details';
  return <Wrapper className={`weekly-tags ${expanded ? 'task-tags-visible' : ''}`}>{expanded ? <h4>标签</h4> : <summary>人工计划标签{data?.tags.some((tag) => tag.marked && tag.dimension === 'milestone') ? ' · 里程碑外' : ''}{data?.tags.some((tag) => tag.marked && tag.dimension === 'weekly' && tag.week === week) ? ' · 本周计划外' : ''}</summary>}
    {(!expanded || data?.inherited) && <p>两个维度独立标记；未标记不等于计划内。{data?.inherited && '当前沿用关联团队任务标签，原独立标签保留。'}</p>}
    {(error || save.error || state.error) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message}</p>}
    {data && <><label>标签归属周<input type="date" value={week} onChange={(event) => { if (event.target.value) setWeek(weekStart(event.target.value)); }} /></label><div className="weekly-toolbar">{(['milestone', 'weekly'] as const).map((dimension) => { const marked = data.tags.some((tag) => tag.dimension === dimension && tag.week === (dimension === 'weekly' ? week : '') && tag.marked); return <button type="button" aria-pressed={marked} key={dimension} disabled={!data[dimension] || data.inherited || save.isPending} onClick={() => toggle(dimension)}>{expanded ? marked ? '✓ ' : '' : marked ? '取消' : '标记'}{dimension === 'milestone' ? '里程碑外' : `${week} 周计划外`}</button>; })}</div><ul>{data.tags.filter((tag) => tag.marked && (!expanded || tag.dimension === 'weekly' && tag.week !== week)).map((tag) => <li key={tag.id}>{tag.dimension === 'milestone' ? '里程碑外' : `${tag.week} 周计划外`}</li>)}</ul></>}
  </Wrapper>;
}
