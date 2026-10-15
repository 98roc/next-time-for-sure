import { BlockerForm } from './blocker-form';
import { AssignmentPicker } from './assignment-picker';
import { AssignmentPersonal } from './assignment-personal';
import { useRef, useState } from 'react';

import { localDate, weekStart } from '../layout/week-picker';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignmentCommandSchema } from '@ntfs/contracts';
import type { Assignment, AssignmentCommand, AssignmentCompletion, Identity, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { assignmentCommand, assignmentSnapshot, assignmentCompletion } from './assignments-api';

const statuses = { not_started: '待开始', in_progress: '进行中', completed: '已完成', exited: '已退出', transferred: '已转交' };
/** datetime-local使用本机时区，编辑前回填现有时间，避免未编辑字段被误清空。 */
function localTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
type Props = { task: WorkSnapshot['tasks'][number]; organization: OrganizationSnapshot; identity: Identity; hasChildren: boolean; onArrange: () => void };

/** 分工独立显示来源、负责小组与本人事实，不用任务整体状态覆盖个人状态。 */
export function AssignmentPanel({ task, organization, identity, hasChildren, onArrange }: Props) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['assignments', identity.id, task.projectId], queryFn: () => assignmentSnapshot(task.projectId), retry: false });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (command: AssignmentCommand) => assignmentCommand(command, identity.csrfToken),
    onSuccess: async (_, command) => { operation.current = null; setNotice(command.action === 'transfer' ? '已转交。原分工的周安排保留为停止记录，请为接手人重新安排周计划。' : '分工已更新。'); setRevision((value) => value + 1); await Promise.all(['assignments', 'personal', 'work', 'organization', 'weekly', 'reports', 'overview'].map((key) => client.invalidateQueries({ queryKey: [key] }))); },
  });
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const teamLeader = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id);
  const permission = (role: 'team_leader' | 'group_leader') => organization.policies.some((policy) => policy.role === role && policy.permissions.includes('work.assign'));
  const managedGroups = organization.groups.filter((group) => group.teamId === project?.teamId && ((teamLeader && permission('team_leader')) || (group.leaderId === identity.id && permission('group_leader'))));
  const canAssignDirect = teamLeader && permission('team_leader');
  const canAssign = canAssignDirect || managedGroups.length > 0;
  const ownGroups = organization.groups.filter((group) => group.teamId === project?.teamId && group.memberIds.includes(identity.id));
  const entries = state.isError ? [] : state.data?.assignments.filter((entry) => entry.taskId === task.id) ?? [];
  const executable = !hasChildren && !['completed', 'cancelled'].includes(task.status);
  const person = (id: string) => organization.accounts.find((entry) => entry.id === id)?.displayName ?? '成员';

  function send(input: unknown) {
    const parsed = assignmentCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请核对成员、小组、必要说明及日期。归属周须填写周一日期。'); return; }
    const command = parsed.data;
    if ('operationId' in command) {
      const content = JSON.stringify({ ...command, operationId: '' });
      if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() };
      command.operationId = operation.current.id;
    }
    setError(''); setNotice(''); save.mutate(command);
  }
  function claimWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    send({ action: 'claim', taskId: task.id, groupId: String(form.get('groupId') ?? '') || null, content: String(form.get('content')), operationId: crypto.randomUUID() });
  }
  return <section className="assignment-panel"><h3>人员分工 · {entries.filter((entry) => !['exited', 'transferred'].includes(entry.status)).length} 项</h3>
    {hasChildren && <p>父任务只汇总和整体结束，请在子任务安排执行；这里保留原分工历史。</p>}{state.isPending && <p role="status">正在加载分工…</p>}{(state.isError || save.isError || error) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message} <button onClick={() => { void state.refetch(); }}>刷新分工</button></p>}{notice && <p role="status">{notice}</p>}
    {executable && state.data && !state.isError && entries.length === 0 && <div className="inline-notice"><p>{canAssign ? '还没有执行分工，在下方选择执行人；不指定小组时由团队负责人统筹。' : '你可以认领自己的工作，也可由团队负责人安排执行人员。'}</p></div>}
    {entries.map((entry) => <details className="assignment-entry" key={`${entry.id}:${entry.version}`}><summary><strong>{person(entry.accountId)}</strong><span>{organization.groups.find((group) => group.id === entry.groupId)?.name ?? '团队直属'} · {statuses[entry.status]}</span><small>{entry.content || '查看分工、进展与责任调整'}</small></summary>{entry.blockedReason && <p>分工受阻：{entry.blockedReason}</p>}{entry.originTaskId && <p>拆分迁移自<a href={`#task-${entry.originTaskId}`}>原任务</a>，进展与实际时间保留原记录。</p>}<p>实际开始：{entry.startedAt ? new Date(entry.startedAt).toLocaleString('zh-CN') : '未记录'}<br />实际结束：{entry.endedAt ? new Date(entry.endedAt).toLocaleString('zh-CN') : '未记录'}</p>{entry.transferredAt && <p>转交时间：{new Date(entry.transferredAt).toLocaleString('zh-CN')}</p>}
      {state.data?.progress.filter((progress) => progress.assignmentId === entry.id).map((progress) => <p key={progress.id}>{progress.occurredOn} · 归属周 {progress.reportWeek}<br />{progress.content}</p>)}
      {entry.accountId === identity.id && executable && !['exited', 'transferred'].includes(entry.status) && <AssignmentPersonal task={task} entry={entry} identity={identity} />}
      {entry.accountId === identity.id && <BlockerForm projectId={task.projectId} taskId={task.id} value={entry} pending={save.isPending} send={(fields) => send({ action: 'assignment_blocker', assignmentId: entry.id, version: entry.version, ...fields })} />}{entry.accountId === identity.id && <OwnExecution entry={entry} executable={executable} pending={save.isPending} send={send} />}
      {executable && !['exited', 'transferred'].includes(entry.status) && (entry.groupId === null ? canAssignDirect : managedGroups.some((group) => group.id === entry.groupId)) && <ResponsibilityEditor canAssignDirect={canAssignDirect} entry={entry} groups={managedGroups} organization={organization} pending={save.isPending} send={send} />}
    </details>)}
    {executable && <div key={revision}>
      {!entries.some((entry) => entry.accountId === identity.id && !['exited', 'transferred'].includes(entry.status)) && !canAssignDirect && <form className="assignment-picker" onSubmit={claimWork}><h4>我来做</h4><label>负责小组<select name="groupId" defaultValue={ownGroups[0]?.id ?? ''}><option value="">团队直属</option>{ownGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>工作内容（选填）<input name="content" maxLength={20000} /></label><button disabled={save.isPending}>认领本人工作</button></form>}
      {canAssign && project && state.data && !state.isError && <AssignmentPicker key={task.id} taskId={task.id} ownerId={task.ownerId} teamId={project.teamId} identity={identity} organization={organization} groups={managedGroups} entries={entries} onAssigned={onArrange} />}
    </div>}
    {canAssign && entries.some((entry) => ['not_started', 'in_progress'].includes(entry.status)) && <div className="workflow-footer"><button onClick={onArrange}>下一步：安排本周或下周 →</button></div>}

  </section>;
}

/** 责任调整只展示当前动作所需字段；接手人跟随小组筛选，周安排影响在提交前说明。 */
function ResponsibilityEditor({ entry, groups, organization, pending, send, canAssignDirect }: { canAssignDirect: boolean; entry: Assignment; groups: OrganizationSnapshot['groups']; organization: OrganizationSnapshot; pending: boolean; send: (input: unknown) => void }) {
  const [action, setAction] = useState<'adjust' | 'transfer'>('adjust');
  const [groupId, setGroupId] = useState(entry.groupId ?? '');
  const group = groups.find((item) => item.id === groupId);
  return <details><summary>调整或转交责任</summary><form onSubmit={(event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    send({ action, assignmentId: entry.id, groupId: groupId || null, content: String(form.get('content')), version: entry.version, ...(action === 'transfer' ? { accountId: String(form.get('accountId')), reason: String(form.get('reason')), operationId: crypto.randomUUID() } : {}) });
  }}><fieldset disabled={pending}><label>操作<select value={action} onChange={(event) => setAction(event.target.value === 'transfer' ? 'transfer' : 'adjust')}><option value="adjust">调整负责小组与内容</option><option value="transfer">转交给其他成员</option></select></label><label>负责小组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{canAssignDirect && <option value="">团队直属</option>}{groups.filter((item) => action === 'transfer' || item.memberIds.includes(entry.accountId)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>工作内容<textarea name="content" defaultValue={entry.content} maxLength={20000} /></label>
    {action === 'transfer' && <><label>接手人<select name="accountId" key={groupId} required><option value="">请选择接手人</option>{organization.accounts.filter((account) => !account.disabled && account.id !== entry.accountId && (group ? group.memberIds.includes(account.id) : canAssignDirect && account.teamId === organization.accounts.find((person) => person.id === entry.accountId)?.teamId)).map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label><label>转交原因<textarea name="reason" required maxLength={20000} /></label><p className="inline-notice">转交后原分工停止执行，其周安排与历史记录保留。保存后请进入“周安排”为接手人安排本周或下周。</p></>}
    <button disabled={pending}>保存责任调整</button></fieldset></form></details>;
}

/** 本人执行入口保留已停止分工的补记能力，不让管理者代为操作。 */
function OwnExecution({ entry, executable, pending, send }: { entry: Assignment; executable: boolean; pending: boolean; send: (input: unknown) => void }) {
  const [review, setReview] = useState<AssignmentCompletion | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  async function complete() {
    setReviewing(true); setReviewError('');
    try {
      const result = await assignmentCompletion(entry.id);
      if (!result.unfinished.length) send({ action: 'complete', assignmentId: entry.id, version: result.assignmentVersion });
      else setReview(result);
    } catch (error) { setReviewError(error instanceof Error ? error.message : '无法读取最新影响范围。'); }
    finally { setReviewing(false); }
  }
  const active = executable && !['transferred', 'exited'].includes(entry.status);
  return <><div className="assignment-actions">{active && entry.status !== 'in_progress' && <button disabled={pending} onClick={() => send({ action: 'start', assignmentId: entry.id, version: entry.version })}>{entry.status === 'completed' ? '恢复执行' : '开始'}</button>}{!['transferred', 'exited', 'completed'].includes(entry.status) && <button disabled={pending || reviewing} onClick={() => { void complete(); }}>完成我的部分</button>}</div>
    {reviewError && <p role="alert">{reviewError}</p>}{review && <div role="alert"><p>仍有以下个人工作未完成。确认后将停止它们的执行，保留本人原状态，不会自动标记完成。</p><ul>{review.unfinished.map((item) => <li key={item.id}>{item.title}</li>)}</ul><button disabled={pending} onClick={() => send({ action: 'complete', assignmentId: entry.id, version: review.assignmentVersion, confirmation: review.confirmation })}>确认完成我的分工</button><button onClick={() => setReview(null)}>取消</button></div>}
    <details><summary>记录进展或补记</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'record_progress', assignmentId: entry.id, version: entry.version, occurredOn: String(form.get('occurredOn')), reportWeek: weekStart(String(form.get('reportWeek'))), content: String(form.get('content')), operationId: crypto.randomUUID() }); }}><label>实际发生日期<input type="date" name="occurredOn" defaultValue={localDate()} required /></label><label>归属周（选择其中任意一天）<input type="date" name="reportWeek" defaultValue={weekStart(localDate())} required /></label><label>本条进展<textarea name="content" required maxLength={20000} /></label><button disabled={pending}>添加进展</button></form></details>
    <details><summary>修正本人实际时间</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const time = (name: string) => { const value = String(form.get(name) ?? ''); return value ? new Date(value).toISOString() : null; }; send({ action: 'correct_times', assignmentId: entry.id, version: entry.version, startedAt: time('startedAt'), endedAt: time('endedAt') }); }}><label>实际开始<input type="datetime-local" name="startedAt" step="0.001" defaultValue={localTime(entry.startedAt)} /></label><label>实际结束<input type="datetime-local" name="endedAt" step="0.001" defaultValue={localTime(entry.endedAt)} /></label><small>按本机时区填写；留空清除此时间，不改变执行状态。</small><button disabled={pending}>保存实际时间</button></form></details>
    {active && entry.source === 'claimed' && entry.status !== 'completed' && <details><summary>退出本次认领</summary><form onSubmit={(event) => { event.preventDefault(); send({ action: 'exit', assignmentId: entry.id, version: entry.version, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><label>退出原因<textarea name="reason" required maxLength={20000} /></label><button disabled={pending}>退出认领</button></form></details>}
  </>;
}
