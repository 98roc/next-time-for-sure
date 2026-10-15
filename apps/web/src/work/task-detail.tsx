import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import type { Identity, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { TaskLifecycle } from '../lifecycle/task-lifecycle';
import { TagsPanel } from '../weekly-plans/tags-panel';
import { TaskMilestone } from './task-milestone';
import { TaskControls } from './task-controls';
import { TaskEditor } from './task-editor';
import { TaskOwnerEditor } from './task-owner-editor';
import { AssignmentPanel } from './assignment-panel';
import { TaskWeekPlan } from './task-week-plan';
import './task-workflow.css';

/** 创建后直接进入人员分工，再进入同源周安排；低频管理与执行事实独立展示。 */
export function TaskDetail({ task, data, organization, identity, onClose, onSelect }: { task: WorkSnapshot['tasks'][number]; data: WorkSnapshot; organization: OrganizationSnapshot; identity: Identity; onClose: () => void; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'people' | 'week' | 'progress' | 'more'>('people');
  const busy = useIsMutating() > 0;
  const children = data.tasks.filter((entry) => entry.parentId === task.id);
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const labels = { not_started: '待开始', in_progress: '进行中', completed: '已完成', cancelled: '已取消' };
  const milestone = data.milestones.find((entry) => entry.id === task.milestoneId);
  return <Dialog title={task.title} onClose={onClose} busy={busy} drawer className="task-workflow">
    <div className="task-overview"><div className="detail-meta"><span className="status-badge">{labels[task.status]}</span>{task.expectedOn && <span>预计完成 {task.expectedOn}</span>}<span>累计进度 {task.progress}%</span></div>
      <TaskOwnerEditor key={task.id} task={task} organization={organization} identity={identity} />
      <p className="detail-meta">里程碑 · {milestone?.title ?? '未关联'}</p>
      <TaskEditor key={task.version} task={task} identity={identity} />
      {(task.description || task.acceptance) && <details><summary>任务说明与完成标准</summary>{task.description && <p>{task.description}</p>}{task.acceptance && <p>完成标准：{task.acceptance}</p>}</details>}
      {task.parentId && <button onClick={() => onSelect(task.parentId ?? '')}>← 查看父任务</button>}
    </div>
    {children.length > 0 && <section><h3>子任务 · {children.length}</h3>{children.map((child) => <p key={child.id}><button onClick={() => onSelect(child.id)}>{child.title}</button> · {labels[child.status]}</p>)}<p className="subtitle">在子任务中分配人员和安排周计划，父任务汇总整体结果。</p></section>}
    <nav className="view-tabs workflow-tabs" aria-label="任务操作"><button disabled={busy} aria-pressed={tab === 'people'} onClick={() => setTab('people')}>① 人员分工</button><button disabled={busy || children.length > 0} aria-pressed={tab === 'week'} onClick={() => setTab('week')}>② 周安排</button><button disabled={busy} aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>进度与执行</button><button disabled={busy} aria-pressed={tab === 'more'} onClick={() => setTab('more')}>更多</button></nav>
    <div hidden={tab !== 'people'}><AssignmentPanel task={task} organization={organization} identity={identity} hasChildren={children.length > 0} onArrange={() => setTab('week')} /></div>
    {tab === 'week' && project && <TaskWeekPlan task={task} teamId={project.teamId} identity={identity} onAssign={() => setTab('people')} />}
    {tab === 'progress' && <TaskControls task={task} organization={organization} identity={identity} />}
    {tab === 'more' && <><TaskMilestone task={task} data={data} identity={identity} organization={organization} /><details><summary>标签与任务管理</summary><TagsPanel objectId={task.id} objectKind="task" /><TaskLifecycle task={task} identity={identity} organization={organization} /></details><details><summary>变更记录</summary>{data.events.filter((entry) => entry.objectId === task.id).map((entry) => <p key={entry.id}>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {typeof entry.payload.reason === 'string' ? entry.payload.reason : typeof entry.payload.content === 'string' ? entry.payload.content : '任务信息更新'}</p>)}</details></>}
  </Dialog>;
}
