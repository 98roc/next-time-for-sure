import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Assignment, AssignmentCommand, Identity, OrganizationSnapshot } from '@ntfs/contracts';
import { assignmentCommand } from './assignments-api';

type Selection = { accountId: string; groupId: string | null; content: string };
type Props = { taskId: string; ownerId: string; teamId: string; identity: Identity; organization: OrganizationSnapshot; groups: OrganizationSnapshot['groups']; entries: Assignment[]; onAssigned: () => void; onClose: () => void };

/** 同行选择执行人、小组和工作内容；整批保存失败时保留选择，不产生半批分工。 */
export function AssignmentPicker({ taskId, ownerId, teamId, identity, organization, groups, entries, onAssigned, onClose }: Props) {
  const client = useQueryClient();

  // 只保存明确选择，主负责人身份不自动产生执行分工。
  const [choices, setChoices] = useState<Record<string, Selection | null>>({});
  const [query, setQuery] = useState('');
  const operation = useRef({ content: '', id: '' });
  const people = organization.accounts.filter((account) => !account.disabled && account.teamId === teamId && !entries.some((entry) => entry.accountId === account.id && !['exited', 'transferred'].includes(entry.status)))
    .sort((a, b) => Number(b.id === ownerId) - Number(a.id === ownerId) || Number(b.id === identity.id) - Number(a.id === identity.id));
  const canAssignDirect = organization.teams.some((team) => team.id === teamId && team.leaderId === identity.id);
  const selected = people.flatMap((person) => {
    const row = choices[person.id];
    return row && (row.groupId === null ? canAssignDirect : groups.some((entry) => entry.id === row.groupId && entry.memberIds.includes(person.id))) ? [row] : [];
  });
  const save = useMutation({
    mutationFn: (command: AssignmentCommand) => assignmentCommand(command, identity.csrfToken),
    onSuccess: async () => {
      setChoices({ [ownerId]: null }); operation.current = { content: '', id: '' };
      await Promise.all(['assignments', 'organization', 'work', 'weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] })));
      onAssigned();
    },
  });
  function toggle(accountId: string, checked: boolean) {
    const group = groups.find((entry) => entry.memberIds.includes(accountId));
    if (!group && !canAssignDirect) return;
    setChoices((rows) => ({ ...rows, [accountId]: checked ? selected.find((row) => row.accountId === accountId) ?? { accountId, groupId: group?.id ?? null, content: '' } : null }));
  }
  function change(accountId: string, fields: Partial<Selection>) {
    const row = selected.find((entry) => entry.accountId === accountId);
    if (row) setChoices((rows) => ({ ...rows, [accountId]: { ...row, ...fields } }));
  }
  if (!people.length) return <p>没有可添加的人员。<button onClick={onClose}>关闭</button></p>;
  return <form className="assignment-picker" onSubmit={(event) => {
    event.preventDefault(); if (!selected.length) return;
    const content = JSON.stringify(selected);
    if (operation.current.content !== content) operation.current = { content, id: crypto.randomUUID() };
    save.mutate({ action: 'assign_many', taskId, members: selected, operationId: operation.current.id });
  }}><fieldset disabled={save.isPending}>
    <div className="section-heading"><h4>添加人员</h4>{people.some((person) => person.id === identity.id && (canAssignDirect || groups.some((group) => group.memberIds.includes(person.id)))) && <button type="button" onClick={() => toggle(identity.id, true)}>我来做</button>}</div>
    <p className="assignment-picker-hint">选择人员后可补充分工，保存后生效。</p>
    <label><span className="sr-only">搜索执行人</span><input type="search" placeholder="搜索姓名或账号" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="assignment-picker-list">{people.filter((person) => `${person.displayName} ${person.loginName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((person) => {
      const row = selected.find((entry) => entry.accountId === person.id);
      const availableGroups = groups.filter((group) => group.memberIds.includes(person.id));
      return <div className={`assignment-picker-row ${row ? 'is-selected' : ''}`} key={person.id}>
        <label className="assignment-person"><input type="checkbox" disabled={!availableGroups.length && !canAssignDirect} checked={Boolean(row)} onChange={(event) => toggle(person.id, event.target.checked)} /><span>{person.displayName}{person.id === ownerId && <span className="assignment-owner-label">主负责人</span>}<small>{person.loginName}</small></span></label>
        {row ? <><label><span className="sr-only">{person.displayName}的负责小组</span><select disabled={!row} value={row ? row.groupId ?? '' : availableGroups[0]?.id ?? ''} onChange={(event) => change(person.id, { groupId: event.target.value || null })}>{canAssignDirect && <option value="">团队直属</option>}{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label><span className="sr-only">{person.displayName}的工作内容</span><input disabled={!row} placeholder="工作内容（选填）" maxLength={20000} value={row?.content ?? ''} onChange={(event) => change(person.id, { content: event.target.value })} /></label></> : <span className="detail-meta">{availableGroups.map((group) => group.name).join('、') || (canAssignDirect ? '团队直属' : '无分配权限')}</span>}
      </div>;
    })}</div>
    {save.error && <p role="alert" className="form-error">{save.error.message} 选择已保留，请刷新分工核对后重试。</p>}
    <div className="workflow-footer"><span className="detail-meta">已选 {selected.length} 人，可跨小组多选</span><button type="button" disabled={save.isPending} onClick={onClose}>取消</button><button className="primary-button" disabled={!selected.length || save.isPending}>{save.isPending ? '正在分配…' : '添加所选人员'}</button></div>
  </fieldset></form>;
}
