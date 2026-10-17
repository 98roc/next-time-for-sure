import { useRef, useState } from 'react';
import type { V2WeeklyState } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { Feedback, useAction } from './controls';
import { useNavigationGuard } from './navigation-guard';

type Draft = { body: string; sourceHash: string; version: number };
type TextState = { draft?: Draft; preview?: Draft };

/** 每个区间组合独立保存本地编辑草稿，轮询只更新来源，不覆盖用户文字。 */
export function WeeklyReport({ state: incoming }: { state: V2WeeklyState | undefined }) {
  const { run } = useWorkspace(), action = useAction(), text = useRef<HTMLPreElement>(null);
  const [states, setStates] = useState<Record<string, TextState>>({}), [copyStatus, setCopyStatus] = useState(''), [cancelKey, setCancelKey] = useState<string | null>(null);
  const dirty = Object.values(states).some((item) => item.draft);
  useNavigationGuard(dirty);
  if (!incoming) return null;
  const state = incoming, key = `${state.summaryPeriod.id}:${state.planPeriod.id}`, current = states[key] ?? {};
  function patch(value: TextState) { setStates((previous) => ({ ...previous, [key]: value })); }
  async function save(mode: 'save' | 'verify' | 'regenerate', input: Draft) {
    await run('report', { action: mode, operationId: createOperationId(), summaryPeriodId: state.summaryPeriod.id, planPeriodId: state.planPeriod.id, version: input.version, sourceHash: input.sourceHash, body: input.body });
    patch({});
  }
  async function copy() {
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(state.text.body); setCopyStatus('已复制当前显示的文字'); }
    catch { if (text.current) { const range = document.createRange(); range.selectNodeContents(text.current); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); setCopyStatus('已选中文字，请按 Ctrl+C 或使用系统复制'); } }
  }
  return <section className="w-report" aria-label="文字版"><header className="w-report-head"><div><h2>文字版</h2><span className="w-small w-muted">{state.canEditText ? '全部项目' : '当前有权项目'} · {state.text.manual ? '已手工编辑' : '随任务自动更新'}</span></div><div className="w-row">
    {current.draft ? <><button className="w-button" disabled={action.busy} onClick={() => setCancelKey(key)}>取消编辑</button><button className="w-button primary" disabled={action.busy} onClick={() => { const draft = current.draft; if (draft) void action.act(() => save('save', draft)); }}>保存文字</button></> : <>{state.canEditText && <button className="w-button" onClick={() => patch({ draft: { body: state.text.body, sourceHash: state.text.sourceHash, version: state.text.version } })}>编辑</button>}{state.canEditText && state.text.manual && <button className="w-button" onClick={() => patch({ preview: { body: state.generatedText, sourceHash: state.currentSourceHash, version: state.text.version } })}>重新生成</button>}<button className="w-button primary" onClick={() => { void copy(); }}>一键复制</button></>}
  </div></header>
    {cancelKey === key && <div className="w-report-notice" role="alert"><span>放弃本次未保存的文字？</span><button className="w-button" onClick={() => setCancelKey(null)}>继续编辑</button><button className="w-button" onClick={() => { patch({}); setCancelKey(null); }}>放弃修改</button></div>}
    {state.text.stale && <div className="w-report-notice" role="status"><span>任务安排有更新，文字版尚未同步。已保留你的文字。</span>{state.canEditText && !current.draft && <button className="w-button" disabled={action.busy} onClick={() => { void action.act(() => save('verify', { body: state.text.body, sourceHash: state.currentSourceHash, version: state.text.version })); }}>我已核对，保留当前文字</button>}</div>}
    {current.draft ? <label className="w-field">编辑文字<textarea rows={15} maxLength={200000} value={current.draft.body} disabled={action.busy} onChange={(event) => { if (current.draft) patch({ ...current, draft: { ...current.draft, body: event.target.value } }); }} /></label> : <pre className="w-report-copy" ref={text}>{state.text.body}</pre>}
    {current.preview && <section className="w-regenerate"><div className="w-row w-between"><h3>重新生成预览</h3><div className="w-row"><button className="w-button" onClick={() => patch({})}>保留原文</button><button className="w-button primary" disabled={action.busy || current.preview.sourceHash !== state.currentSourceHash || current.preview.version !== state.text.version} onClick={() => { const preview = current.preview; if (preview) void action.act(() => save('regenerate', preview)); }}>确认替换</button></div></div><pre className="w-report-copy">{current.preview.body}</pre>{(current.preview.sourceHash !== state.currentSourceHash || current.preview.version !== state.text.version) && <p className="w-report-notice">来源或文字已变化，请更新预览后再次确认。<button className="w-button" onClick={() => patch({ preview: { body: state.generatedText, sourceHash: state.currentSourceHash, version: state.text.version } })}>更新预览</button></p>}<span className="w-small w-muted">确认替换会覆盖手工文字，并恢复自动更新。</span></section>}
    <Feedback error={action.error} /><div className="w-report-footer"><span role="status" className="w-small w-muted">{copyStatus}</span></div>
  </section>;
}
