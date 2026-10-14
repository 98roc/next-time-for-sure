import type { Identity, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { TaskLifecycle } from '../lifecycle/task-lifecycle';
import { TagsPanel } from '../weekly-plans/tags-panel';
import { TaskControls } from './task-controls';
import { AssignmentPanel } from './assignment-panel';

/** 所有任务入口打开同一详情；父子导航保留当前项目及视图。 */
export function TaskDetail({ task, data, organization, identity, onClose, onSelect }: { task: WorkSnapshot['tasks'][number]; data: WorkSnapshot; organization: OrganizationSnapshot; identity: Identity; onClose: () => void; onSelect: (id: string) => void }) {
  const children = data.tasks.filter((entry) => entry.parentId === task.id);
  const labels = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };
  return <Dialog title={task.title} onClose={onClose} drawer><div className="detail-meta"><span className="status-badge">{labels[task.status]}</span><span>{organization.accounts.find((entry) => entry.id === task.ownerId)?.displayName ?? '成员'}</span><span>{task.expectedOn ?? '未排期'}</span></div>
    {task.parentId && <button className="text-button" onClick={() => onSelect(task.parentId ?? '')}>← 查看父任务</button>}
    {task.description && <section><h3>任务说明</h3><p>{task.description}</p></section>}{task.acceptance && <section><h3>完成标准</h3><p>{task.acceptance}</p></section>}
    {children.length > 0 && <section><h3>子任务 · {children.length}</h3>{children.map((child) => <p key={child.id}><button className="text-button" onClick={() => onSelect(child.id)}>{child.title}</button> · {labels[child.status]}</p>)}{children.every((entry) => entry.status === 'completed') && task.status !== 'completed' && <p role="status">子任务已全部完成，请确认整体结果。</p>}</section>}
    <TaskControls key={task.id} task={task} organization={organization} identity={identity} />
    <AssignmentPanel task={task} organization={organization} identity={identity} hasChildren={children.length > 0} />
    <details><summary>标签与更多管理</summary><TagsPanel objectId={task.id} objectKind="task" /><TaskLifecycle task={task} identity={identity} organization={organization} /></details>
    <details><summary>变更记录</summary>{data.events.filter((entry) => entry.objectId === task.id).map((entry) => <p key={entry.id}>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {typeof entry.payload.reason === 'string' ? entry.payload.reason : typeof entry.payload.content === 'string' ? entry.payload.content : '任务信息更新'}</p>)}</details>
  </Dialog>;
}
