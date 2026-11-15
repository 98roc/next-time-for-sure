import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Field } from './controls';
import { MilestoneForm } from './milestone-form';
import { milestoneOptions } from './milestone-options';
import { useModal } from './modal';
import { useWorkspace } from './workspace';
import './task-milestone-field.css';

/** 单条任务和批量记录按行选择目标。快捷创建只更新发起行的草稿，保存任务时提交关联。 */
export function TaskMilestoneField({ projectId, value, originalId, canCreate, disabled, onChange }: {
  projectId: string; value: string | null; originalId: string | null;
  canCreate: boolean; disabled: boolean; onChange: (id: string | null) => void;
}) {
  const { data } = useWorkspace(), modal = useModal();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const select = useRef<HTMLSelectElement>(null), hintId = useId();
  const options = milestoneOptions(data.milestones, projectId, originalId);
  const unavailable = Boolean(value && !options.some((row) => row.id === value));
  const error = unavailable ? '选中的里程碑已不可关联，请重新选择或取消关联。' : '';
  const created = value !== null && value === createdId;

  // 刷新后保留已失效的草稿值，指出对应的行并等用户修改。
  useLayoutEffect(() => { select.current?.setCustomValidity(error); }, [error]);

  function create() {
    modal.push(<MilestoneForm projectId={projectId} onCreated={(id) => {
      setCreatedId(id);
      onChange(id);
    }} />);
  }

  return <div className="v2-full">
    <div className="v2-task-milestone-controls">
      <Field label="关联里程碑"><select ref={select} aria-label="关联里程碑" disabled={disabled} value={value ?? ''} aria-invalid={unavailable || undefined} aria-describedby={unavailable || created ? hintId : undefined} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">不关联里程碑</option>
        {unavailable && <option value={value ?? ''} disabled>已不可关联的里程碑</option>}
        {options.map((row) => <option key={row.id} value={row.id}>{row.title}{row.status === 'completed' ? '（已完成）' : ''}</option>)}
      </select></Field>
      {canCreate && <button className="v2-secondary" type="button" disabled={disabled} onClick={create}>＋ 新建里程碑</button>}
    </div>
    {unavailable ? <p id={hintId} className="v2-error" role="alert">{error}</p>
      : created && <p id={hintId} className="v2-task-milestone-hint" role="status">里程碑已创建，保存任务后生效。</p>}
  </div>;
}
