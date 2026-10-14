import { useQuery } from '@tanstack/react-query';
import type { Identity, LifecycleIntent, PersonalItem } from '@ntfs/contracts';
import { organizationSnapshot } from '../organization/api';
import { LifecyclePanel } from './lifecycle-panel';

/** 个人删除只给本人，跨项目移动只给当前团队负责人。 */
export function PersonalLifecycle({ item, identity }: { item: PersonalItem; identity: Identity }) {
  const organization = useQuery({ queryKey: ['organization', identity.id], queryFn: organizationSnapshot });
  const options: Array<{ label: string; intent: LifecycleIntent }> = item.ownerId === identity.id ? [{ label: '删除本人事项', intent: { action: 'delete_personal', objectId: item.id } }] : [];
  if (item.kind === 'work' && !item.assignmentId && organization.data?.teams.some((team) => team.leaderId === identity.id)) {
    for (const project of organization.data.projects.filter((entry) => !entry.archived && entry.id !== item.projectId)) options.push({ label: `转移至${project.name}`, intent: { action: 'transfer_personal', objectId: item.id, targetProjectId: project.id } });
  }
  return options.length ? <LifecyclePanel identity={identity} options={options} /> : null;
}
