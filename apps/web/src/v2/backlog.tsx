import { useProjectSort } from './project-sort';
import { useId, useState } from 'react';
import type { V2Backlog } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Feedback, Field, useAction } from './controls';
import { PriorityField } from './task-fields';
import { TaskCreate } from './task-create';
import { Confirmation } from './confirmation';

/** 待建列表只展示事项、优先级和创建人，不保留旧需求审批字段。 */
export function BacklogList({ projectId }: { projectId: string }) {
  const { data } = useWorkspace(), modal = useModal(), project = data.projects.find((row) => row.id === projectId);
  const rows = data.backlog.filter((row) => row.projectId === projectId);
  const sort = useProjectSort(rows.map((row) => row.id), 'backlog', projectId);
  const ordered = sort.ids.flatMap((id) => rows.filter((row) => row.id === id));
  return <div ref={sort.root}><div className="nt-tools"><span className="nt-muted">待建任务 · {rows.length}</span><div className="nt-row">{sort.reset}<button className="nt-primary" disabled={project?.canContribute === false} onClick={() => modal.open(<BacklogForm projectId={projectId} />)}>＋ 新增待建任务</button></div></div>{sort.feedback}<div className="nt-project nt-scroll" {...sort.listProps}><table className="nt-table"><thead><tr><th>名称</th><th>优先级</th><th>创建人</th><th>操作</th></tr></thead><tbody>{ordered.map((row) => <tr key={row.id} {...sort.rowProps(row.id)}><td>{sort.handle(row.id, row.title)}<button className="nt-link" onClick={() => modal.open(<BacklogForm projectId={projectId} backlog={row} />)}>{row.title}</button></td><td>{row.priority}</td><td>{data.accounts.find((account) => account.id === row.creatorId)?.displayName ?? '历史成员'}</td><td><button disabled={!project?.canCreate} title={!project?.canCreate ? '仅项目经理角色不能安排正式任务，请由项目研发负责人转换' : undefined} onClick={() => modal.open(<TaskCreate projectId={projectId} backlog={row} />)}>转为任务</button></td></tr>)}</tbody></table>{!rows.length && <div className="nt-empty">暂无待建任务</div>}</div></div>;
}

/** 汇总与项目待建页共用顺序和把手，不复制待建业务操作。 */
export function BacklogSummary({ projectId }: { projectId: string }) {
  const { data } = useWorkspace(), modal = useModal();
  const rows = data.backlog.filter((row) => row.projectId === projectId);
  const sort = useProjectSort(rows.map((row) => row.id), 'backlog', projectId);
  return <div ref={sort.root}><div className="v2-section-heading"><h4>待建任务 · {rows.length}</h4>{sort.reset}</div>{sort.feedback}<div {...sort.listProps}>{sort.ids.map((id) => {
    const row = rows.find((item) => item.id === id); if (!row) return null;
    return <div className="nt-backlog" key={row.id} {...sort.rowProps(row.id)}>{sort.handle(row.id, row.title)}<button className="nt-link" onClick={() => modal.open(<BacklogForm projectId={projectId} backlog={row} />)}>{row.title}</button><span className="nt-prio">{row.priority}</span></div>;
  })}</div></div>;
}

/** 创建人可以维护自己提出的事项，项目管理者可以维护项目内全部待建。 */
export function BacklogForm({ projectId, backlog }: { projectId: string; backlog?: V2Backlog }) {
  const { data, user, run } = useWorkspace(), modal = useModal(), action = useAction(), formId = useId();
  const project = data.projects.find((row) => row.id === projectId), editable = project?.canContribute !== false && (!backlog || backlog.creatorId === user.id || project?.canManage);
  const [title, setTitle] = useState(backlog?.title ?? ''), [priority, setPriority] = useState(backlog?.priority ?? 3);
  return <ModalPage title={backlog ? '待建任务' : '新增待建任务'} dirty={title !== (backlog?.title ?? '') || priority !== (backlog?.priority ?? 3)} busy={action.busy} actions={<>
    {backlog && editable && <button className="v2-danger" disabled={action.busy} onClick={() => modal.push(<Confirmation label="删除待建任务" danger intent={{ action: 'delete_backlog', backlogId: backlog.id, version: backlog.version }} onConfirm={(confirmation) => run('projects', { action: 'delete_backlog', backlogId: backlog.id, version: backlog.version, operationId: createOperationId(), confirmation })} onDone={modal.finish} />)}>删除待建任务</button>}
    {backlog && <button disabled={!project?.canCreate} title={!project?.canCreate ? '请由项目研发负责人安排' : undefined} onClick={() => modal.push(<TaskCreate projectId={projectId} backlog={{ ...backlog, title, priority }} onDone={modal.finish} />)}>转为任务</button>}
    {editable && <button className="nt-primary" form={formId} type="submit" disabled={action.busy}>保存</button>}
  </>}><p className="v2-context">项目：{project?.name} · 创建人：{backlog ? data.accounts.find((row) => row.id === backlog.creatorId)?.displayName ?? '历史成员' : user.displayName}</p><form id={formId} onSubmit={(event) => { event.preventDefault(); void action.act(async () => { await run('projects', backlog ? { action: 'edit_backlog', operationId: createOperationId(), backlogId: backlog.id, version: backlog.version, title, priority } : { action: 'create_backlog', operationId: createOperationId(), projectId, title, priority }); modal.finish(); }); }}><fieldset disabled={action.busy || !editable}><div className="v2-fields"><Field label="事项名称" full><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></Field><PriorityField value={priority} onChange={setPriority} /></div></fieldset><Feedback error={action.error} /></form></ModalPage>;
}
