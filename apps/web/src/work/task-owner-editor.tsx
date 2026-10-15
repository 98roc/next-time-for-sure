import { useState } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Identity, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { taskCommand } from './tasks-api';

/** 在任务摘要中直接更换主负责人；提交编辑开始时的版本，避免覆盖其他人的修改。 */
export function TaskOwnerEditor({ task, organization, identity }: { task: WorkSnapshot['tasks'][number]; organization: OrganizationSnapshot; identity: Identity }) {
  const client = useQueryClient();
  const busy = useIsMutating() > 0;
  const [draft, setDraft] = useState<{ ownerId: string; version: number } | null>(null);
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const canChange = organization.teams.some((entry) => entry.id === project?.teamId && entry.leaderId === identity.id)
    || project?.members.some((entry) => entry.accountId === identity.id && entry.roles.includes('project_lead'));
  const candidates = organization.accounts.filter((account) => !account.disabled && account.teamId === project?.teamId
    && project?.members.some((member) => member.accountId === account.id && member.roles.some((role) => role === 'developer' || role === 'project_lead')));
  const ownerName = organization.accounts.find((entry) => entry.id === task.ownerId)?.displayName ?? '成员';
  const save = useMutation({
    mutationFn: (fields: { ownerId: string; version: number }) => taskCommand({ action: 'change_owner', taskId: task.id, ...fields }, identity.csrfToken),
    onSuccess: async () => {
      setDraft(null);
      await Promise.all(['work', 'assignments', 'personal', 'weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
  const outdated = draft !== null && draft.version !== task.version;
  return <div className={`task-owner-editor${draft ? ' is-editing' : ''}`}>
    <div className="task-owner-heading"><span>主负责人 · {ownerName}</span>{canChange && <button type="button" className="task-owner-change" aria-expanded={draft !== null} disabled={busy} onClick={() => { save.reset(); setDraft(draft ? null : { ownerId: task.ownerId, version: task.version }); }}>{draft ? '收起' : '更换'}</button>}</div>
    {canChange && draft && <form className="task-owner-form" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !outdated && draft.ownerId !== task.ownerId && candidates.some((entry) => entry.id === draft.ownerId)) save.mutate(draft);
    }}>
      <div className="task-owner-fields"><label>新主负责人<select autoFocus value={draft.ownerId} disabled={busy} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}>
        {!candidates.some((entry) => entry.id === draft.ownerId) && <option value={draft.ownerId} disabled>{ownerName}（不可选）</option>}
        {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}（{entry.loginName}）</option>)}
      </select></label><div className="task-owner-actions"><button type="button" disabled={busy} onClick={() => { setDraft(null); save.reset(); }}>取消</button><button className="primary-button" disabled={busy || outdated || draft.ownerId === task.ownerId || !candidates.some((entry) => entry.id === draft.ownerId)}>{save.isPending ? '保存中…' : '保存'}</button></div></div>
      <small>主负责人负责整体推进与确认完成；执行人员在下方分工中安排。</small>
      {outdated && <p role="alert" className="form-error">任务已更新，请取消后重新选择主负责人。</p>}
      {save.isError && <p role="alert" className="form-error">{save.error.message}<button type="button" disabled={busy} onClick={() => { void client.invalidateQueries({ queryKey: ['work'] }); }}>刷新任务</button></p>}
    </form>}
  </div>;
}
