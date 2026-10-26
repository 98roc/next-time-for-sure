import { useState } from 'react';
import type { V2Completion } from '@ntfs/contracts';

/** 日期控件始终按上海时间显示，传输统一为 UTC；不依赖客户端时区。 */
export function shanghaiMinute(instant: string): string { return new Date(Date.parse(instant) + 8 * 3_600_000).toISOString().slice(0, 16); }

/** 默认收起显示具体时间点；未主动修改时由服务器在提交时确定完成时间。 */
export function CompletionTime({ value, onChange, disabled = false }: { value: V2Completion; onChange: (value: V2Completion) => void; disabled?: boolean }) {
  const [openedAt] = useState(() => new Date().toISOString());
  const [invalid, setInvalid] = useState(false);
  const displayed = shanghaiMinute(value.completedAt ?? openedAt);
  return <details className="v2-completion-time"><summary><span>完成时间</span><time>{displayed.replace('T', ' ')}</time><span aria-hidden="true">⌄</span></summary>
    <div className="v2-completion-time-input"><input aria-label="实际完成时间（北京时间）" type="datetime-local" required value={invalid ? '' : displayed} max={shanghaiMinute(new Date().toISOString())} disabled={disabled} onInvalid={(event) => { const details = event.currentTarget.closest('details'); if (details) details.open = true; }} onChange={(event) => {
      const input = event.target.value, instant = new Date(`${input}:00+08:00`);
      setInvalid(!input || !Number.isFinite(instant.getTime()));
      if (input && Number.isFinite(instant.getTime())) onChange({ ...value, completedAt: instant.toISOString() });
    }} /><button type="button" className="nt-link" disabled={disabled} onClick={() => { setInvalid(false); onChange({ ...value, completedAt: new Date().toISOString() }); }}>此刻</button></div>
  </details>;
}
