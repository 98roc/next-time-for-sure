import { useState } from 'react';
import { Dialog } from '../layout/dialog';
import { PersonalDetail, personalStatusLabels } from './personal-detail';
import type { PersonalDetailProps, PersonalDetailView } from './personal-detail';
import { PersonalAction } from './personal-action';

/** 紧凑事项卡片只突出当前下一步；完整内容及低频操作集中在详情。 */
export function PersonalCard(props: PersonalDetailProps) {
  const { item, own, pending, send, data, source } = props;
  const [view, setView] = useState<PersonalDetailView | null>(null);
  const startsNext = item.status === 'not_started' && !item.stopReason;
  return <>
    <article className="personal-card">
      <div className="personal-card-heading"><h3><button className="text-button" title={item.title} onClick={() => setView('content')}>{item.title}</button></h3><button className="personal-card-more" aria-label={`更多操作：${item.title}`} onClick={() => setView('settings')}>···</button></div>
      {item.kind === 'work' && <div className="personal-card-source">{source}{!item.assignmentId && <small>独立工作</small>}</div>}
      {(item.kind === 'private' || item.plannedOn || item.checklist.length > 0) && <div className="personal-card-meta">{item.kind === 'private' && <span>仅自己可见</span>}{item.plannedOn && <span>计划 {item.plannedOn}</span>}{item.checklist.length > 0 && <span>检查项 {item.checklist.filter((entry) => entry.checked).length}/{item.checklist.length}</span>}</div>}
      {item.blockedReason && <p className="personal-card-blocker">受阻 · {item.blockedReason}</p>}
      {item.stopReason && item.status !== 'completed' && <p className="personal-card-blocker">{item.stopReason}</p>}
      <div className="personal-card-footer">{own ? <PersonalAction item={item} categories={data.categories} pending={pending} send={send} label="移动" className="text-button" /> : <span className="status-badge">{personalStatusLabels[item.status]}</span>}{own && <div className="personal-card-actions">{startsNext ? <PersonalAction item={item} categories={data.categories} pending={pending} send={send} status="in_progress" label="开始" className="primary-button" /> : <><button className="text-button" onClick={() => setView('progress')}>{item.status === 'completed' ? '查看进展' : '记录进展'}</button>{item.status === 'in_progress' && <PersonalAction item={item} categories={data.categories} pending={pending} send={send} status="completed" label="完成" className="primary-button" />}</>}</div>}</div>
    </article>
    {view && <Dialog title={item.title} drawer className="personal-dialog" busy={pending} onClose={() => setView(null)}><PersonalDetail {...props} initialView={view} /></Dialog>}
  </>;
}
