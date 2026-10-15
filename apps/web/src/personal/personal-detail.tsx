import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AssignmentSnapshot, PersonalItem, PersonalSnapshot } from '@ntfs/contracts';
import { TagsPanel } from '../weekly-plans/tags-panel';
import { PersonalHistory } from './personal-history';
import { PersonalContentForm, PersonalProgressForm } from './personal-forms';
import { PersonalAction } from './personal-action';
import type { PersonalSend } from './personal-forms';

export type PersonalDetailView = 'content' | 'progress' | 'settings';
export type PersonalDetailProps = {
  item: PersonalItem; own: boolean; data: PersonalSnapshot; assignments: AssignmentSnapshot | undefined;
  pending: boolean; send: PersonalSend; management: ReactNode; feedback: ReactNode; source?: ReactNode;
};
export const personalStatusLabels = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };

/** 本地时间回填保留毫秒，未编辑字段不误清空。 */
function localTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}

/** 将日常内容、进展与低频设置分区，管理者仍不能编辑他人的执行事实。 */
export function PersonalDetail({ item, own, data, assignments, pending, send, management, feedback, initialView }: PersonalDetailProps & { initialView: PersonalDetailView }) {
  const [view, setView] = useState<PersonalDetailView>(initialView);
  const [editing, setEditing] = useState(false);
  const base = { itemId: item.id, version: item.version };
  const column = data.items.filter((entry) => entry.ownerId === item.ownerId && entry.categoryId === item.categoryId);
  const previous = column[column.findIndex((entry) => entry.id === item.id) - 1];
  const progress = data.progress.filter((entry) => entry.itemId === item.id);
  const canStart = (item.status !== 'in_progress' || item.stopReason === '关联分工已完成') && (!item.stopReason || item.stopReason === '关联分工已完成');
  return <div className="personal-detail">
    <div className="personal-detail-summary"><div className="detail-meta"><span className="status-badge">{personalStatusLabels[item.status]}</span>{item.kind === 'private' && <span>仅自己可见</span>}{item.plannedOn && <span>计划 {item.plannedOn}</span>}</div>
      {own && <div className="personal-detail-actions">{canStart && <PersonalAction item={item} categories={data.categories} pending={pending} send={send} status="in_progress" label={item.status === 'not_started' ? '开始' : '恢复执行'} className="primary-button" />}{item.status !== 'completed' && <PersonalAction item={item} categories={data.categories} pending={pending} send={send} status="completed" label="完成事项" />}</div>}
    </div>
    {item.stopReason && <p className="inline-notice">{item.stopReason}，保留本人原状态，可整理和补记。</p>}
    {own && item.assignmentId && item.status === 'completed' && item.stopReason === '关联分工已完成' && <p className="inline-notice" role="status">我的团队分工已完成。</p>}
    <div className="view-tabs" aria-label="事项详情视图">{([{ id: 'content', title: '事项内容' }, { id: 'progress', title: '进展记录' }, { id: 'settings', title: '更多设置' }] as const).map((tab) => <button key={tab.id} aria-pressed={view === tab.id} onClick={() => setView(tab.id)}>{tab.title}</button>)}</div>
    {feedback}
    <section hidden={view !== 'content'} aria-label="事项内容">
      {editing && own ? <PersonalContentForm item={item} pending={pending} send={send} onCancel={() => setEditing(false)} /> : <>
        <div className="section-heading"><h3>内容与检查清单</h3>{own && <button onClick={() => setEditing(true)}>编辑内容</button>}</div>
        {!item.description && !item.acceptance && !item.blockedReason && !item.checklist.length && <p className="detail-meta">{own ? '可以补充说明、完成标准和检查项。' : '暂无补充内容。'}</p>}
        {item.description && <div className="personal-content-block"><h4>说明</h4><p>{item.description}</p></div>}
        {item.acceptance && <div className="personal-content-block"><h4>完成标准</h4><p>{item.acceptance}</p></div>}
        {item.blockedReason && <p className="form-error">受阻 · {item.blockedReason}</p>}
        {item.checklist.length > 0 && <ul className="personal-checklist">{item.checklist.map((entry) => <li key={entry.id}><span aria-label={entry.checked ? '已完成' : '未完成'}>{entry.checked ? '✓' : '○'}</span>{entry.title}</li>)}</ul>}
      </>}
      {item.kind === 'work' && <TagsPanel objectId={item.id} objectKind="personal" expanded />}
    </section>
    <section hidden={view !== 'progress'} aria-label="进展记录">
      {own && <PersonalProgressForm item={item} pending={pending} send={send} />}
      {(item.startedAt || item.endedAt) && <p className="detail-meta">{item.startedAt && <span>开始 {new Date(item.startedAt).toLocaleString('zh-CN')}</span>}{item.endedAt && <span>完成 {new Date(item.endedAt).toLocaleString('zh-CN')}</span>}</p>}
      <h3>已记录的进展{progress.length > 0 ? ` · ${progress.length}` : ''}</h3>
      {progress.length === 0 ? <p className="detail-meta">暂无进展记录。</p> : <ol className="personal-progress-list">{progress.map((entry) => <li key={entry.id}><div className="detail-meta"><time>{entry.occurredOn}</time><span>归属周 {entry.reportWeek}</span></div><p>{entry.content}</p></li>)}</ol>}
      {item.assignmentId && <details><summary>同一分工的其他进展</summary><ol className="personal-progress-list">{[...(assignments?.progress ?? []), ...(assignments?.linkedProgress ?? [])].filter((entry) => entry.assignmentId === item.assignmentId && !progress.some((own) => own.id === entry.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((entry) => <li key={entry.id}><div className="detail-meta">{entry.occurredOn} · 归属周 {entry.reportWeek}</div><p>{entry.content}</p></li>)}</ol></details>}
    </section>
    <section hidden={view !== 'settings'} className="personal-settings" aria-label="更多设置">
      {own && <>
        <details><summary>分类与排序</summary><p className="detail-meta">也可以直接在看板拖动卡片。</p><form className="personal-form" onSubmit={(event) => { event.preventDefault(); send({ ...base, action: 'move_personal', categoryId: String(new FormData(event.currentTarget).get('categoryId')) || null, position: 1000000 }); }}><label>分类<select name="categoryId" defaultValue={item.categoryId ?? ''}>{data.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><div className="personal-form-actions"><button type="button" disabled={pending || !previous} onClick={() => { if (previous) send({ action: 'insert_personal', ...base, categoryId: item.categoryId, beforeId: previous.id, order: column.filter((entry) => entry.id !== item.id).map(({ id, version }) => ({ id, version })) }); }}>在本分类上移</button><button disabled={pending}>移至分类末尾</button></div></form></details>
        {item.kind === 'work' && <details><summary>关联本人团队分工</summary><form className="personal-form" onSubmit={(event) => { event.preventDefault(); send({ ...base, action: 'link_personal', assignmentId: String(new FormData(event.currentTarget).get('assignmentId')) || null }); }}><label>关联分工<select key={assignments ? 'loaded' : 'loading'} name="assignmentId" defaultValue={item.assignmentId ?? ''}><option value="">独立工作</option>{assignments?.assignments.filter((entry) => entry.accountId === item.ownerId && (!['transferred', 'exited'].includes(entry.status) || entry.id === item.assignmentId)).map((entry) => <option key={entry.id} value={entry.id}>{entry.content || '未填写分工内容'} · {entry.status === 'completed' ? '已完成' : '有效分工'}</option>)}</select></label><div className="personal-form-actions"><button disabled={pending || !assignments}>保存关联</button></div></form></details>}
        <details><summary>修正实际时间</summary><form className="personal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const time = (name: string) => { const value = String(form.get(name)); return value ? new Date(value).toISOString() : null; }; send({ ...base, action: 'personal_times', startedAt: time('startedAt'), endedAt: time('endedAt') }); }}><div className="personal-form-grid"><label>实际开始<input type="datetime-local" step="0.001" name="startedAt" defaultValue={localTime(item.startedAt)} /></label><label>实际结束<input type="datetime-local" step="0.001" name="endedAt" defaultValue={localTime(item.endedAt)} /></label></div><div className="personal-form-actions"><button disabled={pending}>保存时间</button></div></form></details>
      </>}
      {own && <PersonalHistory item={item} />}{management}
    </section>
  </div>;
}
