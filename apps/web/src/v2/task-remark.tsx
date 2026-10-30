import { useId, useState } from 'react';
import { v2TaskRemarkMaxLength } from '@ntfs/contracts';
import './task-remark.css';

/** 新建与编辑共用的任务备注；每次打开默认折叠，收起保留草稿，只读用户可展开查看。 */
export function TaskRemark({ value, onChange, readOnly = false, disabled = false }: { value: string; onChange?: (value: string) => void; readOnly?: boolean; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false), id = useId();
  return <div className="v2-task-remark">
    <button type="button" className="v2-task-remark-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      <span>备注</span><svg className="v2-task-remark-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{value.trim() && <small>已填写</small>}
    </button>
    <div id={id} hidden={!expanded}><textarea aria-label="备注" rows={4} maxLength={v2TaskRemarkMaxLength} value={value} placeholder={readOnly ? '暂无备注' : '填写备注…'} readOnly={readOnly} disabled={disabled} onChange={(event) => onChange?.(event.target.value)} /></div>
  </div>;
}
