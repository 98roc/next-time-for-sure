import { useState } from 'react';
import type { PersonalItem } from '@ntfs/contracts';
import { localDate, weekStart } from '../layout/week-picker';

export type PersonalSend = (input: unknown, onSuccess?: () => void) => void;
type Props = { item: PersonalItem; pending: boolean; send: PersonalSend };

/** 内容和清单一次保存；未保存的增删只改变当前表单。 */
export function PersonalContentForm({ item, pending, send, onCancel }: Props & { onCancel: () => void }) {
  const [checklist, setChecklist] = useState(item.checklist);
  const [removing, setRemoving] = useState<string | null>(null);
  return <form className="personal-form" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    send({ itemId: item.id, version: item.version, action: 'edit_personal', title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')), plannedOn: String(form.get('plannedOn')) || null, blockedReason: String(form.get('blockedReason')), checklist }, onCancel);
  }}><fieldset disabled={pending}>
    <label>事项名称<input name="title" required defaultValue={item.title} maxLength={200} /></label>
    <label>说明<textarea name="description" defaultValue={item.description} maxLength={20000} /></label>
    <label>完成标准<textarea name="acceptance" defaultValue={item.acceptance} maxLength={20000} /></label>
    <label>计划日期<input name="plannedOn" type="date" defaultValue={item.plannedOn ?? ''} /></label>
    <label>阻塞说明<textarea name="blockedReason" defaultValue={item.blockedReason} maxLength={20000} placeholder="清空可解除阻塞" /></label>
    <div className="personal-checklist-editor"><h3>检查清单</h3>
      {checklist.map((entry) => <div className="checklist-row" key={entry.id}>
        <input type="checkbox" aria-label={`勾选${entry.title || '检查项'}`} checked={entry.checked} onChange={(event) => setChecklist(checklist.map((row) => row.id === entry.id ? { ...row, checked: event.target.checked } : row))} />
        <input aria-label="检查项内容" required maxLength={200} value={entry.title} onChange={(event) => setChecklist(checklist.map((row) => row.id === entry.id ? { ...row, title: event.target.value } : row))} />
        <button type="button" className="text-button" onClick={() => setRemoving(entry.id)}>移除</button>
      </div>)}
      {removing && <div className="inline-notice" role="alert"><p>移除“{checklist.find((entry) => entry.id === removing)?.title}”？保存后不提供恢复。</p><div className="personal-form-actions"><button type="button" onClick={() => setRemoving(null)}>保留</button><button type="button" className="danger-button" onClick={() => { setChecklist(checklist.filter((entry) => entry.id !== removing)); setRemoving(null); }}>确认移除</button></div></div>}
      <button type="button" disabled={Boolean(item.stopReason) || checklist.length >= 100} onClick={() => setChecklist([...checklist, { id: crypto.randomUUID(), title: '', checked: false }])}>＋ 添加检查项</button>
    </div>
    <div className="personal-form-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary-button">{pending ? '正在保存…' : '保存内容'}</button></div>
  </fieldset></form>;
}

/** 先记录进展内容，发生日期和归属周仍分别提交，支持补记。 */
export function PersonalProgressForm({ item, pending, send }: Props) {
  return <form className="personal-form" onSubmit={(event) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    send({ itemId: item.id, version: item.version, action: 'personal_progress', occurredOn: String(form.get('occurredOn')), reportWeek: weekStart(String(form.get('reportWeek'))), content: String(form.get('content')), operationId: crypto.randomUUID() }, () => element.reset());
  }}><fieldset disabled={pending}>
    <label>进展内容<textarea name="content" required maxLength={20000} placeholder="记录完成了什么、遇到的问题或下一步" /></label>
    <div className="personal-form-grid"><label>发生日期<input type="date" name="occurredOn" defaultValue={localDate()} required /></label><label>归属周<input type="date" name="reportWeek" defaultValue={weekStart(localDate())} required /></label></div>
    <p className="detail-meta">补记时可调整日期；归属周选择其中任意一天。</p>
    <div className="personal-form-actions"><button className="primary-button">{pending ? '正在保存…' : '记录进展'}</button></div>
  </fieldset></form>;
}
