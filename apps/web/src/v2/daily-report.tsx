import { ConfirmationPage } from './confirmation-page';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v2DateSchema, type V2DailyReport } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { readDaily } from './api';
import { ModalPage, useModal } from './modal';
import { Feedback, useAction } from './controls';
import { ReportTextEditor } from './report-text-editor';
import { usePrivateListSort } from './private-list-sort';
import { DateNavigator } from './personal-completed';

/** 日报默认当天，独立于看板筛选；日期切换期间不携带上一天的稿件。 */
export function DailyReport() {
  const { data, user, run } = useWorkspace(), modal = useModal();
  const [on, setOn] = useState(data.today);
  const query = useQuery({ queryKey: ['v2', 'daily', user.id, on], queryFn: () => readDaily(on), refetchInterval: 10000 });
  if (!query.data) return <ModalPage title="我的日报" wide><Feedback error={query.error?.message ?? ''} /><p>{query.error ? '无法读取日报。' : '正在读取日报…'}</p></ModalPage>;
  const state = query.data;
  return <ReportTextEditor key={on} title="我的日报" state={state} scope={`仅自己可见 · ${state.preferences.projectOrder === null ? '跟随项目顺序' : '个人项目顺序'}`} canEdit readError={query.error?.message ?? ''} onSave={async (mode, input) => {
    const actions = { save: 'save_daily', verify: 'verify_daily', regenerate: 'regenerate_daily' } as const;
    await run('daily', { action: actions[mode], operationId: createOperationId(), on, ...input });
  }} toolbar={(locked) => <div className="v2-daily-toolbar"><DateNavigator value={on} today={data.today} disabled={locked} label="日报日期" onChange={(date) => { if (v2DateSchema.safeParse(date).success) setOn(date); }} /><details className="mw-col-menu"><summary aria-label="日报选项">⋯</summary><div className="mw-col-menu-panel"><button disabled={locked || Boolean(query.error)} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); modal.push(<DailyProjectOrder initial={state} />); }}>项目排序</button><button disabled={locked || state.preferences.projectOrder === null || Boolean(query.error)} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); modal.push(<ResetDailyOrder version={state.preferences.version} />); }}>恢复跟随项目排序</button></div></details></div>} />;
}

/** 排序为本人跨日期偏好；弹窗保持初始版本，其他设备保存后明确冲突。 */
function DailyProjectOrder({ initial }: { initial: V2DailyReport }) {
  const { run, data } = useWorkspace(), modal = useModal(), action = useAction();
  const [ids, setIds] = useState(initial.projects.map((row) => row.id));
  const dirty = ids.join() !== initial.projects.map((row) => row.id).join(), stale = data.personalPreferences.version !== initial.preferences.version;
  const sort = usePrivateListSort(ids, setIds, action.busy || stale);
  return <ModalPage title="日报项目排序" subtitle="仅本人" dirty={dirty} busy={action.busy} actions={<button className="nt-primary" disabled={action.busy || stale || (!dirty && initial.preferences.projectOrder !== null)} onClick={() => { void action.act(async () => { await run('personal-settings', { action: 'set_daily_project_order', operationId: createOperationId(), version: initial.preferences.version, projectIds: ids }); modal.finish(); }); }}>保存</button>}>
    <p className="v2-context">仅影响本人日报，不改变项目页和其他人的顺序。</p><Feedback error={action.error || (stale ? '个人偏好已更新，请返回后重新打开排序。' : '')} />
    <div ref={sort.root} className="v2-private-list" {...sort.listProps}>{ids.map((id) => <div key={id} data-sort-id={id} className="v2-private-row">{sort.handle(id, initial.projects.find((row) => row.id === id)?.name ?? '')}<span>{initial.projects.find((row) => row.id === id)?.name}</span></div>)}</div>
    <p className="v2-context">个人任务固定放在项目之后；新增项目追加在个人顺序末尾。</p>
  </ModalPage>;
}

/** 恢复只删除个人排序覆盖，不修改项目页共享排序或已保存的手工文字。 */
function ResetDailyOrder({ version }: { version: number }) {
  const { run } = useWorkspace(), modal = useModal(), action = useAction();
  return <ConfirmationPage title="恢复跟随项目排序" busy={action.busy} actions={<button className="nt-primary" disabled={action.busy} onClick={() => { void action.act(async () => { await run('personal-settings', { action: 'set_daily_project_order', operationId: createOperationId(), version, projectIds: null }); modal.finish(); }); }}>确认恢复</button>}><p>本人日报恢复使用项目页顺序。手工编辑过的日报仍保留原文。</p><Feedback error={action.error} /></ConfirmationPage>;
}
