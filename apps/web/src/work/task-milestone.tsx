import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Identity, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { milestoneCommand } from './milestones-api';

/** 任务只关联同项目一个目标；权限和并发版本由后端再次验证。 */
export function TaskMilestone({ task, data, identity, organization }: { task: WorkSnapshot['tasks'][number]; data: WorkSnapshot; identity: Identity; organization: OrganizationSnapshot }) {
  const client = useQueryClient();
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const roles = project?.members.find((entry) => entry.accountId === identity.id)?.roles ?? [];
  const leader = organization.teams.some((entry) => entry.id === project?.teamId && entry.leaderId === identity.id);
  const manage = organization.policies.some((entry) => entry.permissions.includes('milestones.manage') && (entry.role === 'team_leader' ? leader : roles.some((role) => role === entry.role)));
  const save = useMutation({ mutationFn: (milestoneId: string | null) => milestoneCommand({ action: 'link_task', taskId: task.id, version: task.version, milestoneId }, identity.csrfToken), onSuccess: () => client.invalidateQueries({ queryKey: ['work'] }) });
  const node = data.milestones.find((entry) => entry.id === task.milestoneId);
  return <section><h3>关联里程碑</h3><p>{node?.title ?? '未关联'}</p>{(task.ownerId === identity.id || manage) && <details><summary>修改关联里程碑</summary><form key={task.version} onSubmit={(event) => { event.preventDefault(); save.mutate(String(new FormData(event.currentTarget).get('milestone')) || null); }}><fieldset disabled={save.isPending}><label>阶段目标<select name="milestone" defaultValue={task.milestoneId ?? ''}><option value="">不关联里程碑</option>{data.milestones.filter((entry) => entry.status !== 'removed').map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.status === 'completed' ? '（已完成）' : ''}</option>)}</select></label><button>保存关联</button></fieldset></form></details>}{save.error && <p role="alert" className="form-error">{save.error.message}</p>}</section>;
}
