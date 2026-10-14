import type { Identity, LifecycleIntent, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { LifecyclePanel } from './lifecycle-panel';
/** 操作入口随当前角色收敛，最终权限仍由后端检查。 */
export function TaskLifecycle({ task, identity, organization }: { task: WorkSnapshot['tasks'][number]; identity: Identity; organization: OrganizationSnapshot }) {
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const leader = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id);
  const options: Array<{ label: string; intent: LifecycleIntent }> = [];
  if (leader || task.ownerId === identity.id || project?.members.some((member) => member.accountId === identity.id && member.roles.includes('project_lead'))) options.push({ label: '删除任务', intent: { action: 'delete_task', objectId: task.id } });
  if (leader && !task.parentId) for (const target of organization.projects.filter((entry) => entry.teamId === project?.teamId && entry.id !== task.projectId && !entry.archived)) options.push({ label: `转移至${target.name}`, intent: { action: 'transfer_task', objectId: task.id, targetProjectId: target.id } });
  return options.length ? <LifecyclePanel identity={identity} options={options} /> : null;
}
