import { useQuery } from '@tanstack/react-query';
import type { Identity, PersonalItem } from '@ntfs/contracts';
import { organizationSnapshot } from '../organization/api';
import { assignmentSnapshot } from '../work/assignments-api';

/** 管理者只维护关联，不展示或发送他人的内容与实际执行字段。 */
export function ManageLink({ item, identity, pending, send }: { item: PersonalItem; identity: Identity; pending: boolean; send: (input: unknown) => void }) {
  const org = useQuery({ queryKey: ['organization', identity.id], queryFn: organizationSnapshot });
  const project = org.data?.projects.find((entry) => entry.id === item.projectId);
  const canManageDirect = Boolean(org.data?.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id) && org.data?.policies.some((policy) => policy.role === 'team_leader' && policy.permissions.includes('work.assign')));
  const groups = org.data?.groups.filter((group) => group.memberIds.includes(item.ownerId) && org.data?.policies.some((policy) => policy.permissions.includes('work.assign') && ((policy.role === 'group_leader' && group.leaderId === identity.id) || (policy.role === 'team_leader' && org.data?.teams.some((team) => team.id === group.teamId && team.leaderId === identity.id))))) ?? [];
  const enabled = item.kind === 'work' && Boolean(item.projectId) && (canManageDirect || groups.length > 0);
  const assignments = useQuery({ queryKey: ['assignments', identity.id, item.projectId], queryFn: () => assignmentSnapshot(item.projectId ?? ''), enabled, retry: false });
  if (!enabled) return null;
  const current = assignments.data?.assignments.find((entry) => entry.id === item.assignmentId);
  const canManage = (groupId: string | null) => groupId === null ? canManageDirect : groups.some((group) => group.id === groupId);
  // 已关联工作按实际负责范围授权，不从执行人的其他小组推导管理权。
  if (current && !canManage(current.groupId)) return null;
  const targets = assignments.data?.assignments.filter((entry) => entry.accountId === item.ownerId && (entry.id === item.assignmentId || (canManage(entry.groupId) && ['not_started', 'in_progress'].includes(entry.status)))) ?? [];
  return <details className="panel"><summary>管理关联归属</summary><p>仅调整关联，保留本人内容、状态和时间；原分工和目标分工均须有安排权限，团队直属由团队负责人管理。</p>{assignments.isError && <p role="alert">{assignments.error.message}</p>}<form onSubmit={(event) => { event.preventDefault(); send({ action: 'manage_link', itemId: item.id, version: item.version, assignmentId: String(new FormData(event.currentTarget).get('assignmentId')) || null }); }}><select key={assignments.data ? 'loaded' : 'loading'} aria-label="目标成员分工" name="assignmentId" defaultValue={item.assignmentId ?? ''}><option value="">独立工作</option>{targets.map((entry) => <option key={entry.id} value={entry.id}>{entry.groupId === null ? '团队直属 · ' : ''}{entry.content || '未填写分工内容'}</option>)}</select><button disabled={pending || !assignments.data || assignments.isError}>保存关联</button></form></details>;
}
