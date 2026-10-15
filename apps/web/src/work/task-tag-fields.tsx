import { useState } from 'react';
import type { Identity, OrganizationSnapshot, WorkCommand } from '@ntfs/contracts';
import { weekStart } from '../layout/week-picker';
import { selectedWeek } from '../weekly-plans/reporting-api';

/** 新建任务时显式多选现有标签；未选择不代表计划内，权限沿用标签管理规则。 */
export function TaskTagFields({ identity, organization, projectId, initialWeek }: { identity: Identity; organization: OrganizationSnapshot; projectId: string; initialWeek?: string }) {
  const project = organization.projects.find((entry) => entry.id === projectId);
  const teamLead = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id);
  const milestone = teamLead || Boolean(project?.members.some((entry) => entry.accountId === identity.id && entry.roles.includes('project_lead')));
  return <CreationTagFields milestone={milestone} weeklyAllowed={teamLead} initialWeek={initialWeek} />;
}

/** 个人与团队工作共用标签选择布局，调用方分别提供当前可维护维度。 */
export function CreationTagFields({ milestone = true, weeklyAllowed = true, initialWeek }: { milestone?: boolean; weeklyAllowed?: boolean; initialWeek?: string | undefined }) {
  const [week, setWeek] = useState(initialWeek ?? selectedWeek());
  const [weekly, setWeekly] = useState(false);
  return <section className="task-tag-fields"><h4>标签（可多选）</h4><div className="task-tag-options">
    <label title={milestone ? '' : '由团队负责人或项目研发负责人标记'}><input type="checkbox" name="tagMilestone" disabled={!milestone} />里程碑外</label>
    <label title={weeklyAllowed ? '' : '新任务尚无分工，由团队负责人标记周计划外'}><input type="checkbox" name="tagWeekly" disabled={!weeklyAllowed} checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />周计划外</label>
  </div>{weekly && <label className="task-tag-week">标签归属周<input type="date" name="tagWeek" value={week} required onChange={(event) => { if (event.target.value) setWeek(weekStart(event.target.value)); }} /></label>}
  <small className="detail-meta">按实际情况选择；未标记不代表计划内。{(!milestone || !weeklyAllowed) && '灰色标签需由对应负责人标记。'}</small></section>;
}

/** 表单只提交明确勾选的标签，周次由契约再次校验。 */
export function taskCreationTags(form: FormData): NonNullable<Extract<WorkCommand, { action: 'create_task' }>['tags']> {
  return [...(form.has('tagMilestone') ? [{ dimension: 'milestone' as const, week: null }] : []), ...(form.has('tagWeekly') ? [{ dimension: 'weekly' as const, week: String(form.get('tagWeek')) }] : [])];
}
