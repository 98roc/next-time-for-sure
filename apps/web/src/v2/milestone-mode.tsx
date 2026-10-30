import type { V2MilestoneMode } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { Feedback, useAction } from './controls';
import { useWorkspace } from './workspace';

/** 所有里程碑入口保存同一账号偏好；失败保留原选择，版本冲突不覆盖其他设备的修改。 */
export function MilestoneModeControl() {
  const { data, run } = useWorkspace(), action = useAction();
  const preference = data.personalPreferences;
  function select(mode: V2MilestoneMode) {
    if (mode === preference.milestoneMode) return;
    void action.act(() => run('personal-settings', { action: 'set_milestone_mode', operationId: createOperationId(), version: preference.version, mode }));
  }
  return <div className="v2-ms-mode-control"><div className="v2-ms-mode" role="group" aria-label="时间轴展示方式" aria-busy={action.busy}>
    <button type="button" aria-label="换行时间轴" aria-pressed={preference.milestoneMode === 'wrap'} disabled={action.busy} onClick={() => select('wrap')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 11h14a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 16h4" /></svg>换行</button>
    <button type="button" aria-label="横向时间轴" aria-pressed={preference.milestoneMode === 'horizontal'} disabled={action.busy} onClick={() => select('horizontal')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4" /></svg>横向</button>
  </div><Feedback error={action.error} /></div>;
}
