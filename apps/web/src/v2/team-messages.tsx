import { useId, useState } from 'react';
import { v2TeamMessageLimits } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';
import './team-messages.css';

/** 团队负责人维护整份首页标语，草稿在保存失败或版本冲突时保留。 */
export function TeamMessages() {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const [rows, setRows] = useState(() => data.teamMessages.map((text) => ({ id: createOperationId(), text })));
  const [version] = useState(data.teamVersion), [original] = useState(() => JSON.stringify(data.teamMessages));
  const messages = rows.map((row) => row.text);
  return <ModalPage title="首页标语" dirty={JSON.stringify(messages) !== original} busy={action.busy} actions={<button className="nt-primary" type="submit" form={formId} disabled={action.busy}>保存</button>}>
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      void action.act(async () => { await run('team', { action: 'set_messages', operationId: createOperationId(), version, messages }); modal.finish(); });
    }}>
      <p className="v2-context">成员每次进入或刷新“我的工作”时随机展示一条，停留期间不切换。未配置或全部清空后不展示。</p>
      <fieldset className="v2-message-fields" disabled={action.busy}>
        {rows.map((row, index) => <div className="v2-message-row" key={row.id}>
          <Field label={`标语 ${index + 1}`}><textarea aria-label={`标语 ${index + 1}`} rows={2} maxLength={v2TeamMessageLimits.length} value={row.text} onChange={(event) => setRows(rows.map((entry) => entry.id === row.id ? { ...entry, text: event.target.value } : entry))} /></Field>
          <button type="button" aria-label={`删除标语 ${index + 1}`} onClick={() => setRows(rows.filter((entry) => entry.id !== row.id))}>删除</button>
        </div>)}
        <button type="button" disabled={rows.length >= v2TeamMessageLimits.count} onClick={() => setRows([...rows, { id: createOperationId(), text: '' }])}>＋ 新增标语</button>
        <p className="v2-context">{rows.length} / {v2TeamMessageLimits.count} 条，每条最多 {v2TeamMessageLimits.length} 字。空白条目保存时自动移除，修改后统一保存。</p>
      </fieldset>
      <Feedback error={action.error} />
    </form>
  </ModalPage>;
}
