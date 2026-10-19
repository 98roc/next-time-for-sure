import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { V2WeeklyState } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { Feedback, useAction } from './controls';
import { ModalPage } from './modal';
import { readWeekly } from './api';

type Draft = { body: string; sourceHash: string; version: number };
type TextState = { draft?: Draft; preview?: Draft };

/** 弹窗固定打开时的日期组合，订阅最新来源，继续复用共享稿及版本校验。 */
export function WeeklyReport({ summaryId, planId }: { summaryId: string; planId: string }) {
  const query = useQuery({ queryKey: ['v2', 'weekly', summaryId, planId], queryFn: () => readWeekly(summaryId, planId), refetchInterval: 10000 });
  if (!query.data) return <ModalPage title="文字版" wide><Feedback error={query.error?.message ?? ''} /><p>正在读取文字…</p></ModalPage>;
  return <ReportContent incoming={query.data} readError={query.error?.message ?? ''} />;
}

/** 本地草稿不随轮询覆盖；弹窗关闭与离开页面共用未保存保护。 */
function ReportContent({ incoming, readError }: { incoming: V2WeeklyState; readError: string }) {
  const { run } = useWorkspace(), action = useAction(), text = useRef<HTMLPreElement>(null);
  const [current, patch] = useState<TextState>({}), [copyStatus, setCopyStatus] = useState(''), [cancelEdit, setCancelEdit] = useState(false);
  const dirty = Boolean(current.draft), state = incoming;
  async function save(mode: 'save' | 'verify' | 'regenerate', input: Draft) {
    await run('report', { action: mode, operationId: createOperationId(), summaryPeriodId: state.summaryPeriod.id, planPeriodId: state.planPeriod.id, version: input.version, sourceHash: input.sourceHash, body: input.body });
    patch({}); setCancelEdit(false);
  }
  async function copy() {
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(state.text.body); setCopyStatus('已复制当前显示的文字'); }
    catch { if (text.current) { const range = document.createRange(); range.selectNodeContents(text.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); setCopyStatus('已选中文字，请按 Ctrl+C 或使用系统复制'); } }
  }
  return <ModalPage title="文字版" wide dirty={dirty} busy={action.busy} actions={<>
    {current.draft ? <><button disabled={action.busy} onClick={() => setCancelEdit(true)}>取消编辑</button><button className="primary" disabled={action.busy} onClick={() => { const draft = current.draft; if (draft) void action.act(() => save('save', draft)); }}>保存文字</button></> : <>{state.canEditText && <button disabled={action.busy} onClick={() => patch({ draft: { body: state.text.body, sourceHash: state.text.sourceHash, version: state.text.version } })}>编辑</button>}{state.canEditText && state.text.manual && <button disabled={action.busy} onClick={() => patch({ preview: { body: state.generatedText, sourceHash: state.currentSourceHash, version: state.text.version } })}>重新生成</button>}<button className="primary" onClick={() => { void copy(); }}>一键复制</button></>}
  </>}><section className="w-report v2-report-dialog" aria-label="文字内容"><div className="v2-report-meta"><span>{state.canEditText ? '全部项目' : '当前有权项目'} · {state.text.manual ? '已手工编辑' : '随任务自动更新'}</span><span role="status">{copyStatus}</span></div><Feedback error={readError} />
    {cancelEdit && <div className="w-report-notice" role="alert"><span>放弃本次未保存的文字？</span><button className="w-button" onClick={() => setCancelEdit(false)}>继续编辑</button><button className="w-button" onClick={() => { patch({}); setCancelEdit(false); }}>放弃修改</button></div>}
    {state.text.stale && <div className="w-report-notice" role="status"><span>任务安排有更新，文字版尚未同步。已保留你的文字。</span>{state.canEditText && !current.draft && <button className="w-button" disabled={action.busy} onClick={() => { void action.act(() => save('verify', { body: state.text.body, sourceHash: state.currentSourceHash, version: state.text.version })); }}>我已核对，保留当前文字</button>}</div>}
    {current.draft ? <label className="w-field">编辑文字<textarea rows={15} maxLength={200000} value={current.draft.body} disabled={action.busy} onChange={(event) => { if (current.draft) patch({ ...current, draft: { ...current.draft, body: event.target.value } }); }} /></label> : <pre className="w-report-copy" ref={text}>{state.text.body}</pre>}
    {current.preview && <section className="w-regenerate"><div className="w-row w-between"><h3>重新生成预览</h3><div className="w-row"><button className="w-button" onClick={() => patch({})}>保留原文</button><button className="w-button primary" disabled={action.busy || current.preview.sourceHash !== state.currentSourceHash || current.preview.version !== state.text.version} onClick={() => { const preview = current.preview; if (preview) void action.act(() => save('regenerate', preview)); }}>确认替换</button></div></div><pre className="w-report-copy">{current.preview.body}</pre>{(current.preview.sourceHash !== state.currentSourceHash || current.preview.version !== state.text.version) && <p className="w-report-notice">来源或文字已变化，请更新预览后再次确认。<button className="w-button" onClick={() => patch({ preview: { body: state.generatedText, sourceHash: state.currentSourceHash, version: state.text.version } })}>更新预览</button></p>}<span className="w-small w-muted">确认替换会覆盖手工文字，并恢复自动更新。</span></section>}
    <Feedback error={action.error} />
  </section></ModalPage>;
}
