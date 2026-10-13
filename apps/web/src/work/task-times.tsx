import type { WorkSnapshot } from '@ntfs/contracts';

/** 日期输入采用本地时区展示，提交时转换为 UTC；空值明确表示清空。 */
function localTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}

/** 主负责人修正团队整体时间，不代表替成员补记执行事实。 */
export function TaskTimes({ task, pending, send }: { task: WorkSnapshot['tasks'][number]; pending: boolean; send: (input: unknown) => void }) {
  return <details><summary>修正团队整体时间</summary><form onSubmit={(event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const time = (name: string) => { const value = String(form.get(name)); return value ? new Date(value).toISOString() : null; };
    send({ action: 'task_times', taskId: task.id, version: task.version, startedAt: time('startedAt'), endedAt: time('endedAt') });
  }}><fieldset disabled={pending}>
    <label>整体开始<input type="datetime-local" step="0.001" name="startedAt" defaultValue={localTime(task.startedAt)} /></label>
    <label>整体结束<input type="datetime-local" step="0.001" name="endedAt" defaultValue={localTime(task.endedAt)} /></label>
    <small>仅修正本任务时间，不改变状态或成员实际时间。</small><button>保存整体时间</button>
  </fieldset></form></details>;
}
