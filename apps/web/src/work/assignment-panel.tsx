import { useRef, useState } from 'react';
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
type Props = { task: WorkSnapshot['tasks'][number]; organization: OrganizationSnapshot; identity: Identity };

/** 分工独立显示来源、负责小组与本人事实，不用任务整体状态覆盖个人状态。 */
export function AssignmentPanel({ task, organization, identity }: Props) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['assignments', identity.id, task.projectId], queryFn: () => assignmentSnapshot(task.projectId), retry: false });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: (command: AssignmentCommand) => assignmentCommand(command, identity.csrfToken),
    onSuccess: async () => { operation.current = null; setNotice('分工已更新。'); setRevision((value) => value + 1); await Promise.all([client.invalidateQueries({ queryKey: ['assignments'] }), client.invalidateQueries({ queryKey: ['personal'] }), client.invalidateQueries({ queryKey: ['work'] }), client.invalidateQueries({ queryKey: ['organization'] })]); },
  });
  const project = organization.projects.find((entry) => entry.id === task.projectId);
  const teamLeader = organization.teams.some((team) => team.id === project?.teamId && team.leaderId === identity.id);
  const permission = (role: 'team_leader' | 'group_leader') => organization.policies.some((policy) => policy.role === role && policy.permissions.includes('work.assign'));
  const managedGroups = organization.groups.filter((group) => group.teamId === project?.teamId && ((teamLeader && permission('team_leader')) || (group.leaderId === identity.id && permission('group_leader'))));
  const ownGroups = organization.groups.filter((group) => group.teamId === project?.teamId && group.memberIds.includes(identity.id));
  const entries = state.isError ? [] : state.data?.assignments.filter((entry) => entry.taskId === task.id) ?? [];
  const executable = !['completed', 'cancelled'].includes(task.status);
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
  function create(event: FormEvent<HTMLFormElement>, claim: boolean) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    send({ action: claim ? 'claim' : 'assign', taskId: task.id, groupId: String(form.get('groupId')), content: String(form.get('content')), operationId: crypto.randomUUID(), ...(claim ? {} : { accountId: String(form.get('accountId')) }) });
  }
  return <details className="assignment-panel"><summary>人员分工 · {entries.filter((entry) => !['exited', 'transferred'].includes(entry.status)).length}项</summary>
    {state.isPending && <p role="status">正在加载分工…</p>}{(state.isError || save.isError || error) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message} <button onClick={() => { void state.refetch(); }}>刷新分工</button></p>}{notice && <p role="status">{notice}</p>}
    {entries.map((entry) => <section className="assignment-entry request-card" key={`${entry.id}:${entry.version}`}><h4>{person(entry.accountId)} · {statuses[entry.status]}</h4><p>{organization.groups.find((group) => group.id === entry.groupId)?.name} · {entry.source === 'claimed' ? '自行认领' : '管理者分配'}</p>{entry.content && <p>{entry.content}</p>}<p>实际开始：{entry.startedAt ? new Date(entry.startedAt).toLocaleString('zh-CN') : '未记录'}<br />实际结束：{entry.endedAt ? new Date(entry.endedAt).toLocaleString('zh-CN') : '未记录'}</p>{entry.transferredAt && <p>转交时间：{new Date(entry.transferredAt).toLocaleString('zh-CN')}</p>}
      {state.data?.progress.filter((progress) => progress.assignmentId === entry.id).map((progress) => <p key={progress.id}>{progress.occurredOn} · 归属周 {progress.reportWeek}<br />{progress.content}</p>)}
      {entry.accountId === identity.id && <OwnExecution entry={entry} executable={executable} pending={save.isPending} send={send} />}
      {executable && !['exited', 'transferred'].includes(entry.status) && managedGroups.some((group) => group.id === entry.groupId) && <details><summary>调整或转交责任</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const action = String(form.get('action')); send({ action, assignmentId: entry.id, groupId: String(form.get('groupId')), content: String(form.get('content')), version: entry.version, ...(action === 'transfer' ? { accountId: String(form.get('accountId')), reason: String(form.get('reason')), operationId: crypto.randomUUID() } : {}) }); }}><label>操作<select name="action"><option value="adjust">调整负责小组与内容</option><option value="transfer">转交给其他成员</option></select></label><label>负责小组<select name="groupId" defaultValue={entry.groupId}>{managedGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>工作内容<textarea name="content" defaultValue={entry.content} maxLength={20000} /></label><label>接手人（转交时使用）<select name="accountId">{organization.accounts.filter((account) => !account.disabled && account.id !== entry.accountId).map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label><label>转交原因<textarea name="reason" maxLength={20000} /></label><button disabled={save.isPending}>保存责任调整</button></form></details>}
    </section>)}
    {executable && <div key={revision} className="request-card">{ownGroups.length > 0 && <details><summary>认领本人工作</summary><form onSubmit={(event) => create(event, true)}><label>负责小组<select name="groupId">{ownGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>工作内容（选填）<textarea name="content" maxLength={20000} /></label><button disabled={save.isPending}>认领</button></form></details>}{managedGroups.length > 0 && <details><summary>分配人员</summary><form onSubmit={(event) => create(event, false)}><label>负责小组<select name="groupId">{managedGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>执行人<select name="accountId">{organization.accounts.filter((account) => !account.disabled && managedGroups.some((group) => group.memberIds.includes(account.id))).map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label><label>工作内容（选填）<textarea name="content" maxLength={20000} /></label><button disabled={save.isPending}>分配</button></form><p>执行人须属于所选小组；尚未加入项目时自动加入。</p></details>}</div>}
  </details>;
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
  return <><div className="assignment-actions">{active && entry.status !== 'in_progress' && <button disabled={pending} onClick={() => send({ action: 'start', assignmentId: entry.id, version: entry.version })}>{entry.status === 'completed' ? '恢复执行' : '开始'}</button>}{active && entry.status !== 'completed' && <button disabled={pending || reviewing} onClick={() => { void complete(); }}>完成我的部分</button>}</div>
    {reviewError && <p role="alert">{reviewError}</p>}{review && <div role="alert"><p>仍有以下个人工作未完成。确认后将停止它们的执行，保留本人原状态，不会自动标记完成。</p><ul>{review.unfinished.map((item) => <li key={item.id}>{item.title}</li>)}</ul><button disabled={pending} onClick={() => send({ action: 'complete', assignmentId: entry.id, version: review.assignmentVersion, confirmation: review.confirmation })}>确认完成我的分工</button><button onClick={() => setReview(null)}>取消</button></div>}
    <details><summary>记录进展或补记</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'record_progress', assignmentId: entry.id, version: entry.version, occurredOn: String(form.get('occurredOn')), reportWeek: String(form.get('reportWeek')), content: String(form.get('content')), operationId: crypto.randomUUID() }); }}><label>实际发生日期<input type="date" name="occurredOn" required /></label><label>归属周（周一）<input type="date" name="reportWeek" required /></label><label>本条进展<textarea name="content" required maxLength={20000} /></label><button disabled={pending}>添加进展</button></form></details>
    <details><summary>修正本人实际时间</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const time = (name: string) => { const value = String(form.get(name) ?? ''); return value ? new Date(value).toISOString() : null; }; send({ action: 'correct_times', assignmentId: entry.id, version: entry.version, startedAt: time('startedAt'), endedAt: time('endedAt') }); }}><label>实际开始<input type="datetime-local" name="startedAt" step="0.001" defaultValue={localTime(entry.startedAt)} /></label><label>实际结束<input type="datetime-local" name="endedAt" step="0.001" defaultValue={localTime(entry.endedAt)} /></label><small>按本机时区填写；留空清除此时间，不改变执行状态。</small><button disabled={pending}>保存实际时间</button></form></details>
    {active && entry.source === 'claimed' && entry.status !== 'completed' && <details><summary>退出本次认领</summary><form onSubmit={(event) => { event.preventDefault(); send({ action: 'exit', assignmentId: entry.id, version: entry.version, reason: String(new FormData(event.currentTarget).get('reason')) }); }}><label>退出原因<textarea name="reason" required maxLength={20000} /></label><button disabled={pending}>退出认领</button></form></details>}
  </>;
}
