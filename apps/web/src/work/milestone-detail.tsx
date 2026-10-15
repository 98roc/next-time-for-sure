import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { milestoneCommandSchema } from '@ntfs/contracts';
import type { Identity, MilestoneCommand, OrganizationSnapshot, WorkSnapshot } from '@ntfs/contracts';
import { Dialog } from '../layout/dialog';
import { IdentityApiError } from '../identity/api';
import { milestoneCommand } from './milestones-api';

type Milestone = WorkSnapshot['milestones'][number];
type Mode =
  | { kind: 'view' }
  | { kind: 'edit'; original: Milestone; title: string; ownerId: string }
  | { kind: 'date'; original: Milestone; expectedOn: string; reason: string }
  | { kind: 'complete_node' | 'reopen_node' | 'remove_node'; original: Milestone; reason: string };
type Props = {
  milestone: Milestone;
  linked: WorkSnapshot['tasks'];
  identity: Identity;
  accounts: OrganizationSnapshot['accounts'];
  owners: OrganizationSnapshot['accounts'];
  canManage: boolean;
  initialDate?: { version: number; expectedOn: string | null } | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
};

/** 详情默认只读；编辑及状态操作独立提交，保留进入操作时的版本与未保存输入。 */
export function MilestoneDetail({ milestone, linked, identity, accounts, owners, canManage, initialDate, onClose, onOpenTask }: Props) {
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>(() => initialDate
    ? { kind: 'date', original: { ...milestone, version: initialDate.version }, expectedOn: initialDate.expectedOn ?? '', reason: '' }
    : { kind: 'view' });
  const [discard, setDiscard] = useState<'close' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const save = useMutation({
    mutationFn: (command: MilestoneCommand) => milestoneCommand(command, identity.csrfToken),
    onSuccess: () => client.invalidateQueries({ queryKey: ['work'] }),
  });
  const dirty = mode.kind === 'edit'
    ? mode.title !== mode.original.title || mode.ownerId !== mode.original.ownerId
    : mode.kind === 'date'
      ? mode.expectedOn !== (mode.original.expectedOn ?? '') || mode.reason !== ''
      : mode.kind !== 'view' && mode.reason !== '';
  const unfinished = linked.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
  const completed = linked.filter((task) => task.status === 'completed').length;
  const failure = error || (save.error instanceof IdentityApiError ? save.error.message : save.error ? '保存失败，请检查网络后重试。' : '');

  // 同一弹窗内切换模式时，将焦点送到新表单；只读详情聚焦正文而不暗示正在编辑。
  useEffect(() => {
    const target = discard ? content.current?.querySelector<HTMLButtonElement>('[data-continue-editing]')
      : content.current?.querySelector<HTMLInputElement>('input');
    (target ?? content.current)?.focus();
  }, [mode.kind, discard]);

  // 浏览器刷新或离开页面也需保护草稿；关闭弹窗使用下方的行内确认。
  useEffect(() => {
    if (!dirty) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLeave);
    return () => window.removeEventListener('beforeunload', preventLeave);
  }, [dirty]);

  /** 切换操作时清空旧反馈；原始版本只在进入该操作时捕获。 */
  function enter(next: Mode) {
    setError(''); setNotice(''); save.reset(); setMode(next);
  }

  /** 取消与关闭共用草稿保护，继续编辑不会重建表单。 */
  function leave(target: 'close' | 'cancel') {
    if (save.isPending) return;
    if (dirty) { setDiscard(target); return; }
    if (target === 'close') onClose();
    else enter({ kind: 'view' });
  }

  /** 校验当前操作，成功刷新详情；网络失败与版本冲突均保留草稿供核对。 */
  async function submit() {
    if (mode.kind === 'view' || save.isPending || discard) return;
    const base = { milestoneId: milestone.id, version: mode.original.version };
    const command = mode.kind === 'edit'
      ? { ...base, action: 'edit_node', title: mode.title, ownerId: mode.ownerId }
      : mode.kind === 'date'
        ? { ...base, action: 'reschedule_node', expectedOn: mode.expectedOn || null, reason: mode.reason }
        : { ...base, action: mode.kind, ...(mode.kind === 'complete_node' ? {} : { reason: mode.reason }) };
    const parsed = milestoneCommandSchema.safeParse(command);
    if (!parsed.success) { setError('请检查名称、负责人、日期和原因，必填内容不能只含空格。'); return; }
    setError('');
    try {
      await save.mutateAsync(parsed.data);
    } catch {
      return;
    }

    // 已成功写入后清除草稿；查询刷新不改写仍在编辑的其他版本。
    setMode({ kind: 'view' });
    setNotice(mode.kind === 'edit' ? '修改已保存。' : mode.kind === 'date' ? '日期已更新。' : mode.kind === 'complete_node' ? '已确认目标完成。' : mode.kind === 'reopen_node' ? '目标已重新打开。' : '目标已移出里程碑。');
    if (mode.kind === 'remove_node') onClose();
  }

  const title = mode.kind === 'edit' ? '编辑里程碑' : mode.kind === 'date' ? '调整日期'
    : mode.kind === 'complete_node' ? '确认目标完成' : mode.kind === 'reopen_node' ? '重新打开目标'
      : mode.kind === 'remove_node' ? '移出里程碑' : milestone.title;
  const submitLabel = mode.kind === 'edit' ? '保存修改' : mode.kind === 'date' ? '保存日期'
    : mode.kind === 'complete_node' ? '确认完成' : mode.kind === 'reopen_node' ? '重新打开' : '确认移出';
  const headerActions = mode.kind === 'view' && canManage && <div className="milestone-header-actions">
    <button type="button" onClick={() => enter({ kind: 'edit', original: milestone, title: milestone.title, ownerId: milestone.ownerId })}>编辑</button>
    <details className="milestone-more" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
    }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
      <summary aria-label="更多里程碑操作">更多 ···</summary>
      <div><button type="button" className="danger-button" onClick={() => enter({ kind: 'remove_node', original: milestone, reason: '' })}>移出里程碑</button></div>
    </details>
  </div>;

  return <Dialog title={title} onClose={() => leave('close')} busy={save.isPending} className="milestone-detail" headerActions={headerActions}>
    <div ref={content} tabIndex={-1} className="milestone-detail-content">
      {notice && <p role="status" className="milestone-notice">{notice}</p>}
      {mode.kind === 'view' ? <>
        <dl className="milestone-facts">
          <div><dt>状态</dt><dd><span className={`milestone-status ${milestone.status}`}>{milestone.status === 'completed' ? '已确认完成' : '未完成'}</span></dd></div>
          <div><dt>负责人</dt><dd>{accounts.find((entry) => entry.id === milestone.ownerId)?.displayName ?? '成员'}</dd></div>
          <div><dt>预计完成日期</dt><dd>{milestone.expectedOn ?? '未规划日期'}{canManage && <button type="button" className="text-button" onClick={() => enter({ kind: 'date', original: milestone, expectedOn: milestone.expectedOn ?? '', reason: '' })}>调整</button>}</dd></div>
        </dl>
        <section className="milestone-linked" aria-label="关联任务">
          <div className="milestone-section-heading"><h3>关联任务 · {linked.length}</h3>{linked.length > 0 && <span className="detail-meta">已完成 {completed}/{linked.length}</span>}</div>
          {linked.length ? <ul className="milestone-task-list">{linked.map((task) => <li key={task.id}>
            <button type="button" className="text-button" onClick={() => { onClose(); onOpenTask(task.id); }}>{task.title}</button>
            <span className="detail-meta">{task.progress}% · {task.status === 'completed' ? '已完成' : task.status === 'cancelled' ? '已取消' : task.status === 'in_progress' ? '进行中' : '待开始'}</span>
          </li>)}</ul> : <p className="milestone-empty">尚未关联任务。<br /><span className="detail-meta">可在新建任务或任务详情中选择此里程碑。</span></p>}
        </section>
        <footer className="milestone-footer">
          <button type="button" onClick={() => leave('close')}>关闭</button>
          {milestone.ownerId === identity.id && <button type="button" className="primary-button" onClick={() => enter({ kind: milestone.status === 'completed' ? 'reopen_node' : 'complete_node', original: milestone, reason: '' })}>{milestone.status === 'completed' ? '重新打开' : '确认完成'}</button>}
        </footer>
      </> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="detail-meta milestone-context">{milestone.title}</p>
        <fieldset disabled={save.isPending || discard !== null}>
          {mode.kind === 'edit' && <>
            <label>目标名称<input name="title" required maxLength={200} value={mode.title} onChange={(event) => setMode({ ...mode, title: event.target.value })} /></label>
            <label>负责人<select name="owner" required value={mode.ownerId} onChange={(event) => setMode({ ...mode, ownerId: event.target.value })}>
              {!owners.some((entry) => entry.id === mode.ownerId) && <option value={mode.ownerId}>原负责人（请重新选择）</option>}
              {owners.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
            </select></label>
          </>}
          {mode.kind === 'date' && <>
            <p className="detail-meta">原日期：{mode.original.expectedOn ?? '未规划日期'}</p>
            <label>预计完成日期<input type="date" name="date" value={mode.expectedOn} onChange={(event) => setMode({ ...mode, expectedOn: event.target.value })} /><small>留空放入未规划日期</small></label>
          </>}
          {mode.kind === 'complete_node' && <>
            <p>请确认阶段目标已达成。本次操作只完成目标，不改变关联任务状态。</p>
            <p>尚未完成的关联任务：{unfinished.length} 项</p>
            {unfinished.length > 0 && <ul className="milestone-unfinished">{unfinished.map((task) => <li key={task.id}>{task.title}（{task.progress}%）</li>)}</ul>}
          </>}
          {mode.kind === 'remove_node' && <p>移出后将解除 {linked.length} 项任务与此目标的关联；任务、分工和执行历史继续保留。</p>}
          {mode.kind === 'reopen_node' && <p>重新打开后可以继续跟踪目标，请说明原因。</p>}
          {mode.kind !== 'edit' && mode.kind !== 'complete_node' && <label>{mode.kind === 'date' ? '调整原因' : '原因'}<input name="reason" required maxLength={20000} value={mode.reason} onChange={(event) => setMode({ ...mode, reason: event.target.value })} /></label>}
          {failure && <p role="alert" className="form-error">{failure} 请核对后重试，或取消编辑后重新打开详情。</p>}
          <footer className="milestone-footer">
            <button type="button" onClick={() => leave('cancel')}>取消</button>
            <button className={mode.kind === 'remove_node' ? 'danger-button' : 'primary-button'} disabled={mode.kind === 'edit' && !dirty}>{save.isPending ? '保存中…' : submitLabel}</button>
          </footer>
        </fieldset>
      </form>}
      {discard && <div className="milestone-discard" role="alert">
        <p>有尚未保存的修改，要放弃吗？</p>
        <div className="milestone-footer">
          <button type="button" className="danger-button" onClick={() => { const target = discard; setDiscard(null); if (target === 'close') onClose(); else enter({ kind: 'view' }); }}>放弃修改</button>
          <button type="button" className="primary-button" data-continue-editing onClick={() => setDiscard(null)}>继续编辑</button>
        </div>
      </div>}
    </div>
  </Dialog>;
}
