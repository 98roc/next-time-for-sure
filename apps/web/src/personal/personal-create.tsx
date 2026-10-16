import { createOperationId } from '../identity/operation-id';
import { useState } from 'react';
import { personalStatusLabels } from '@ntfs/contracts';
import type { PersonalSnapshot, PersonalTeamWork } from '@ntfs/contracts';
import type { PersonalSend } from './personal-forms';
import { CreationTagFields, taskCreationTags } from '../work/task-tag-fields';

/** 新事项先写标题，独立工作和私人事项共用分类状态，不要求补充说明。 */
export function PersonalCreate({ data, projects, categoryId, pending, send }: { data: PersonalSnapshot; projects: PersonalTeamWork['projects']; categoryId: string | null; pending: boolean; send: PersonalSend }) {
  const [kind, setKind] = useState<'work' | 'private'>(projects.some((entry) => !entry.archived) ? 'work' : 'private');
  const defaults = data.categories.filter((entry) => entry.status === 'not_started');
  return <form className="personal-form personal-create-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'create_personal', title: String(form.get('title')), kind, projectId: kind === 'work' ? String(form.get('projectId')) : null, assignmentId: null, description: String(form.get('description')), acceptance: '', categoryId: String(form.get('categoryId')), operationId: createOperationId(), ...(kind === 'work' ? { tags: taskCreationTags(form) } : {}) }); }}><fieldset disabled={pending}>
    <label>事项标题<input name="title" required maxLength={200} placeholder="接下来要做什么？" /></label>
    <div className="personal-form-grid"><label>类型<select value={kind} onChange={(event) => setKind(event.target.value === 'private' ? 'private' : 'work')}><option value="work" disabled={!projects.some((entry) => !entry.archived)}>工作事项</option><option value="private">私人事项 · 仅自己可见</option></select></label><label>放入分类<select name="categoryId" required defaultValue={categoryId ?? (defaults.length === 1 ? defaults[0]?.id : '')}><option value="" disabled>请选择分类</option>{data.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {personalStatusLabels[entry.status]}</option>)}</select></label></div>
    {kind === 'work' && <label>所属项目<select name="projectId" required defaultValue={projects.filter((entry) => !entry.archived).length === 1 ? projects.find((entry) => !entry.archived)?.id : ''}><option value="" disabled>请选择项目</option>{projects.filter((entry) => !entry.archived).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {kind === 'work' && <CreationTagFields />}
    <details><summary>补充说明（选填）</summary><textarea name="description" aria-label="事项说明" maxLength={20000} /></details><div className="personal-form-actions"><button className="primary-button">创建事项</button></div>
  </fieldset></form>;
}
