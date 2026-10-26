import type { V2Milestone } from '@ntfs/contracts';
import { v2StatusLabels } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { ModalPage, useModal } from './modal';
import { Confirmation } from './confirmation';
import { TaskEditor } from './task-editor';
import { MilestoneForm } from './milestone-form';
import { Deadline, MilestoneStatus, MilestoneTaskIcon } from './milestone-parts';

/** 详情只读共享任务；编辑关联统一进入编辑器，完成仍由研发负责人显式确认。 */
export function MilestoneDetail({ milestoneId }: { milestoneId: string }) {
  const { data } = useWorkspace(), modal = useModal(), milestone = data.milestones.find((row) => row.id === milestoneId);
  if (!milestone) return <ModalPage title="里程碑"><p>里程碑不存在或已失去访问权限。</p></ModalPage>;
  const project = data.projects.find((row) => row.id === milestone.projectId), tasks = data.tasks.filter((row) => row.milestoneId === milestoneId);
  const unfinished = tasks.filter((row) => row.status !== 'completed').length;
  return <ModalPage title={`${project?.name ?? ''} / 里程碑`} className="v2-ms-modal" closeLabel="关闭" footerNote={<span className="v2-ms-footer-note">由项目研发负责人确认</span>} actions={<>
    {project?.canManage && <button onClick={() => modal.push(<MilestoneForm projectId={milestone.projectId} milestone={milestone} />)}>编辑目标</button>}
    <CompleteButton milestone={milestone} disabled={!project?.canConfirmMilestone || (milestone.status === 'open' && unfinished > 0)} />
  </>}>
    <div className="v2-ms-detail"><MilestoneStatus milestone={milestone} /><h3 className="v2-ms-title">{milestone.title}</h3>
      <section className="v2-ms-deadline-box" aria-label="截止日期"><p>截止日期</p>{milestone.expectedOn ? <Deadline date={milestone.expectedOn} today={data.today} completed={milestone.status === 'completed'} /> : <strong>未规划</strong>}</section>
      <h4>关联任务 <small>{tasks.length - unfinished} / {tasks.length} 已完成</small></h4>
      {milestone.needsReview && <p className="v2-ms-warning" role="status">关联任务已回退，阶段目标需要项目研发负责人核验。</p>}
      {unfinished > 0 && milestone.status === 'open' && <p className="v2-ms-warning">还有 {unfinished} 项任务未完成，暂不能确认里程碑完成。</p>}
      <ul className="v2-ms-tasks">{tasks.map((task) => <li key={task.id}><MilestoneTaskIcon status={task.status} /><div><button className="v2-ms-link" onClick={() => modal.push(<TaskEditor task={task} />)}>{task.title}</button><small>{v2StatusLabels[task.status]} · {data.accounts.find((row) => row.id === task.executorId)?.displayName ?? '历史成员'}</small></div></li>)}</ul>
      {!tasks.length && <p className="v2-ms-empty">暂无关联任务</p>}
      {!project?.canConfirmMilestone && <p className="v2-context">由项目研发负责人确认完成或重开。</p>}
    </div>
  </ModalPage>;
}

/** 完成和重开仅记录目标状态，不批量修改关联任务。 */
function CompleteButton({ milestone, disabled }: { milestone: V2Milestone; disabled: boolean }) {
  const { run } = useWorkspace(), modal = useModal();
  const action = milestone.status === 'completed' ? 'reopen_milestone' : 'complete_milestone';
  const label = milestone.status === 'completed' ? '重开里程碑' : '确认完成';
  return <button className="nt-primary" disabled={disabled} onClick={() => modal.push(<Confirmation label={label} intent={{ action, milestoneId: milestone.id, version: milestone.version }} onConfirm={(confirmation) => run('projects', { action, operationId: createOperationId(), milestoneId: milestone.id, version: milestone.version, confirmation })} />)}>{label}</button>;
}
