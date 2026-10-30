import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ModalPage } from './modal';
import { Feedback, useAction } from './controls';
import { ConfirmDialog } from './confirm-dialog';

export type ReportDraft = { body: string; sourceHash: string; version: number };
type ReportState = { text: ReportDraft & { manual: boolean; stale: boolean }; generatedText: string; currentSourceHash: string };
type Props = { title: string; scope: string; state: ReportState; canEdit: boolean; readError: string; onSave: (mode: 'save' | 'verify' | 'regenerate', draft: ReportDraft) => Promise<void>; toolbar?: (locked: boolean) => ReactNode };

/** 周报和私人日报共用文字保护、来源预览、复制及冲突反馈，不复制两套交互规则。 */
export function ReportTextEditor({ title, scope, state, canEdit, readError, onSave, toolbar }: Props) {
  const action = useAction(), text = useRef<HTMLPreElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null), [preview, setPreview] = useState<ReportDraft | null>(null), [cancelEdit, setCancelEdit] = useState(false), [copyStatus, setCopyStatus] = useState('');
  const dirty = draft !== null, busy = action.busy;
  const previewStale = preview !== null && (preview.sourceHash !== state.currentSourceHash || preview.version !== state.text.version);
  function newPreview() { setPreview({ body: state.generatedText, sourceHash: state.currentSourceHash, version: state.text.version }); }
  async function save(mode: 'save' | 'verify' | 'regenerate', value: ReportDraft) { await onSave(mode, value); setDraft(null); setPreview(null); setCancelEdit(false); }
  async function copy() {
    const body = draft?.body ?? state.text.body;
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(body); setCopyStatus('已复制当前显示的文字'); }
    catch {
      // HTTP 站点或受限客户端可能无法使用 Clipboard API，继续尝试用户点击触发的兼容复制。
      if (draft && textarea.current) { textarea.current.focus(); textarea.current.select(); }
      else if (text.current) { const range = document.createRange(); range.selectNodeContents(text.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
      try {
        if (document.execCommand('copy')) { setCopyStatus('已复制当前显示的文字'); return; }
      } catch { /* 浏览器同时禁止两种写入方式时，保留选区供用户手动复制。 */ }
      setCopyStatus('已选中文字，请按 Ctrl+C 或使用系统复制');
    }
  }
  return <ModalPage title={title} wide dirty={dirty} busy={busy} actions={<>
    {draft ? <><button disabled={busy} onClick={() => setCancelEdit(true)}>取消编辑</button><button className="nt-primary" disabled={busy || Boolean(readError)} onClick={() => { void action.act(() => save('save', draft)); }}>保存文字</button></> : <>{canEdit && <button disabled={busy || Boolean(readError)} onClick={() => { setPreview(null); setDraft({ body: state.text.body, sourceHash: state.text.sourceHash, version: state.text.version }); }}>编辑</button>}{canEdit && state.text.manual && <button disabled={busy || Boolean(readError)} onClick={newPreview}>重新生成</button>}</>}
    <button className={draft ? undefined : 'nt-primary'} disabled={busy} onClick={() => { void copy(); }}>一键复制</button>
  </>}>
    <section className="v2-text-report" aria-label="文字内容">{toolbar?.(busy || dirty || preview !== null)}<div className="v2-report-meta"><span>{scope} · {state.text.manual ? '已手工编辑' : '随任务自动更新'}</span><span role="status">{copyStatus}</span></div><Feedback error={readError} />
      {cancelEdit && <ConfirmDialog title="放弃文字修改" confirmLabel="确认放弃" onCancel={() => setCancelEdit(false)} onConfirm={() => { setDraft(null); setCancelEdit(false); }}><p>放弃本次未保存的文字？</p></ConfirmDialog>}
      {state.text.stale && <div className="v2-report-notice" role="status"><span>来源有更新，文字版尚未同步。已保留你的文字。</span>{canEdit && !draft && <button disabled={busy || Boolean(readError)} onClick={() => { void action.act(() => save('verify', { body: state.text.body, sourceHash: state.currentSourceHash, version: state.text.version })); }}>我已核对，保留当前文字</button>}</div>}
      {draft ? <label className="v2-report-edit">编辑文字<textarea ref={textarea} rows={15} maxLength={200000} value={draft.body} disabled={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label> : <pre ref={text}>{state.text.body}</pre>}
      {preview && <section className="v2-report-preview"><div className="v2-report-preview-head"><h3>重新生成预览</h3><div className="v2-actions"><button disabled={busy} onClick={() => setPreview(null)}>保留原文</button><button className="nt-primary" disabled={busy || previewStale || Boolean(readError)} onClick={() => { void action.act(() => save('regenerate', preview)); }}>确认替换</button></div></div><pre>{preview.body}</pre>{previewStale && <div className="v2-report-notice">来源或文字已变化，请更新预览后再次确认。<button onClick={newPreview}>更新预览</button></div>}<small>确认替换会覆盖手工文字，并恢复自动更新。</small></section>}
      <Feedback error={action.error} />
    </section>
  </ModalPage>;
}
