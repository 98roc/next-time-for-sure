import { useId, useState } from 'react';
import { v2StatusLabels, v2StatusSchema, type V2Category } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { ModalPage, useModal } from './modal';
import { useWorkspace } from './workspace';
import { Feedback, Field, useAction } from './controls';
import { Confirmation } from './confirmation';

/** 分类状态创建后固定，改名和设为默认不搬动已有任务。 */
export function CategoryForm({ category }: { category?: V2Category }) {
  const { data, run } = useWorkspace(), modal = useModal(), action = useAction(), id = useId();
  const [name, setName] = useState(category?.name ?? ''), [status, setStatus] = useState(category?.status ?? 'not_started'), [isDefault, setDefault] = useState(false);
  const [version] = useState(data.personalVersion);
  return <ModalPage title={category ? '修改分类名称' : '新增分类'} dirty={name !== (category?.name ?? '') || isDefault || status !== (category?.status ?? 'not_started')} busy={action.busy} actions={<button className="nt-primary" type="submit" form={id} disabled={action.busy}>保存</button>}>
    <form id={id} onSubmit={(event) => { event.preventDefault(); void action.act(async () => { if (category) await run('personal', { action: 'rename_category', operationId: createOperationId(), version, categoryId: category.id, name }); else await run('personal', { action: 'create_category', operationId: createOperationId(), version, name, status, isDefault }); modal.finish(); }); }}><fieldset disabled={action.busy}><div className="v2-fields"><Field label="分类名称" full><input value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} /></Field>{!category && <><Field label="对应执行状态"><select value={status} onChange={(event) => setStatus(v2StatusSchema.parse(event.target.value))}>{v2StatusSchema.options.map((value) => <option key={value} value={value}>{v2StatusLabels[value]}</option>)}</select></Field><label className="v2-check"><input type="checkbox" checked={isDefault} onChange={(event) => setDefault(event.target.checked)} />设为该状态的默认分类</label></>}</div><Feedback error={action.error} /></fieldset></form>
  </ModalPage>;
}

/** 删除分类要求明确同状态接收分类，确认中包含隐藏任务数量。 */
export function DeleteCategory({ category }: { category: V2Category }) {
  const { data, run } = useWorkspace(), modal = useModal();
  const choices = data.categories.filter((row) => row.status === category.status && row.id !== category.id);
  const [receiverId, setReceiver] = useState(choices[0]?.id ?? '');
  return <ModalPage title="删除分类" actions={<button disabled={!receiverId} onClick={() => modal.push(<Confirmation label="删除分类并保留任务" danger intent={{ action: 'delete_category', version: data.personalVersion, categoryId: category.id, receiverId }} onConfirm={(confirmation) => run('personal', { action: 'delete_category', operationId: createOperationId(), version: data.personalVersion, categoryId: category.id, receiverId, confirmation })} onDone={modal.finish} />)}>继续</button>}><p>删除“{category.name}”后，任务移入所选同状态分类。{category.isDefault && '接收分类同时成为默认分类。'}</p>{choices.length ? <Field label="接收分类"><select value={receiverId} onChange={(event) => setReceiver(event.target.value)}>{choices.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field> : <p className="v2-error">这是该状态最后一个分类，不能删除。请先新增一个同状态分类。</p>}</ModalPage>;
}
