import { WeekPicker } from '../layout/week-picker';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { overviewSchema } from '@ntfs/contracts';
import { reportingRequest } from '../weekly-plans/reporting-api';

/** 默认按项目展示，人员视角同时保留跨项目分工与未估算提示。 */
export function OverviewPanel({ accountId }: { accountId: string }) {
  const [week, setWeek] = useState(() => { const now = new Date(); now.setDate(now.getDate() - (now.getDay() + 6) % 7); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; });
  const [view, setView] = useState('project');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(week) && new Date(`${week}T00:00:00Z`).getUTCDay() === 1;
  const data = useQuery({ queryKey: ['overview', accountId, week], queryFn: async () => overviewSchema.parse(await reportingRequest(`lifecycle/overview?week=${week}`)), enabled: valid, retry: false });
  return <section className="weekly-section collection-section overview-section" aria-label="团队总览"><div className="overview-toolbar"><WeekPicker value={week} onChange={setWeek} /><label><span className="sr-only">查看维度</span><select value={view} onChange={(event) => setView(event.target.value)}><option value="project">按项目</option><option value="person">按人员</option></select></label></div>{!valid && <p role="alert">请选择周一日期。</p>}{data.error && <p role="alert">{data.error.message}</p>}{data.isFetching && <p role="status">正在读取总览…</p>}
    {valid && view === 'project' && data.data?.projects.map((project) => <article className="weekly-entry overview-entry" key={project.id}><h3><a href={`/work?projectId=${project.id}`}>{project.name}</a>{project.archived ? ' · 已归档' : ''}</h3><h4>周安排</h4>{!project.arrangements.length && <p>本周无安排。</p>}{project.arrangements.map((row) => <p key={row.sourceIds.join(',')}>{[row.title, row.person, row.plannedDays === null ? '' : `${row.plannedDays}天`].filter(Boolean).join(' · ')}{row.text && <><br />{row.text}</>}</p>)}<h4>相对最近发布的计划变化</h4>{project.changes.length ? <ul>{project.changes.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>暂无调整。</p>}<h4>本周进展</h4>{project.progress.length ? project.progress.map((entry, index) => <p key={index}>{entry.title} · {entry.person} · {entry.occurredOn}<br />{entry.content}</p>) : <p>暂无可见进展。</p>}<h4>待分配与阻塞</h4><ul>{project.unassigned.map((title, index) => <li key={`pending-${index}`}>待分配：{title}</li>)}{project.blockers.map((text, index) => <li key={`blocked-${index}`}>{text}</li>)}</ul>{!project.unassigned.length && !project.blockers.length && <p>暂无。</p>}</article>)}
    {valid && view === 'person' && data.data?.people.map((person) => <article className="weekly-entry overview-entry" key={person.id}><h3>{person.name}</h3>{person.assignments.some((row) => row.plannedDays !== null) && <p>已估算投入 {person.plannedDays} 天{person.unestimated > 0 && `；${person.unestimated} 条分工未估算`}。</p>}<ul>{person.assignments.map((row) => <li key={row.sourceIds.join(',')}>{[row.projectName, row.title, row.text, row.plannedDays === null ? '' : `${row.plannedDays}天`].filter(Boolean).join(' · ')}</li>)}</ul></article>)}
  </section>;
}
