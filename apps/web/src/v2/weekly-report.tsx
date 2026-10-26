import { useQuery } from '@tanstack/react-query';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';
import { Feedback } from './controls';
import { ModalPage, useModal } from './modal';
import { MilestoneOverview } from './milestones';
import { readWeekly } from './api';
import { ReportTextEditor } from './report-text-editor';

/** 固定打开时的日期组合，文字交互复用共用编辑器，权限仍取团队周报服务。 */
export function WeeklyReport({ summaryId, planId }: { summaryId: string; planId: string }) {
  const { run } = useWorkspace(), modal = useModal();
  const query = useQuery({ queryKey: ['v2', 'weekly', summaryId, planId], queryFn: () => readWeekly(summaryId, planId), refetchInterval: 10000 });
  if (!query.data) return <ModalPage title="文字版" wide><Feedback error={query.error?.message ?? ''} /><p>正在读取文字…</p></ModalPage>;
  const state = query.data;
  return <ReportTextEditor title="文字版" state={state} scope={state.canEditText ? '全部项目' : '当前有权项目'} canEdit={state.canEditText} readError={query.error?.message ?? ''} toolbar={(locked) => <div className="v2-report-preview-head"><span>周报与周计划</span><button disabled={locked} onClick={() => modal.push(<MilestoneOverview dialog />)}>里程碑总览</button></div>} onSave={async (mode, input) => {
    await run('report', { action: mode, operationId: createOperationId(), summaryPeriodId: summaryId, planPeriodId: planId, ...input });
  }} />;
}
