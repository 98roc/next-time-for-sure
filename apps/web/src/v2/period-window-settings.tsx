import { v2PeriodWindowLimits, type V2PeriodWindow } from '@ntfs/contracts';

type Props = {
  value: V2PeriodWindow; editable: boolean; busy: boolean;
  onChange: (counts: { before: number; after: number }) => void;
};

/** 只维护展示数量草稿；保存、撤销及冲突反馈统一由弹窗承接。 */
export function PeriodWindowSettings({ value, editable, busy, onChange }: Props) {
  return <section className="v2-period-window" aria-label="团队展示窗口">
    <div className="v2-period-window-heading"><span>展示范围</span><span>共 {value.before + 1 + value.after} 个区间</span></div>
    <div className="v2-period-window-controls">
      {(['before', 'after'] as const).map((side) => {
        const label = side === 'before' ? '向前' : '向后';
        return <label className="v2-period-count" key={side}>{label}<input type="number" aria-label={`${label}区间数量`} min="0" max={v2PeriodWindowLimits.max} step="1" disabled={!editable || busy} value={value[side]} onChange={(event) => {
          const count = Number(event.target.value);
          if (Number.isInteger(count) && count >= 0 && count <= v2PeriodWindowLimits.max) onChange({ before: value.before, after: value.after, [side]: count });
        }} />个{side === 'before' && <span className="v2-period-current">当前区间</span>}</label>;
      })}
    </div>
  </section>;
}
