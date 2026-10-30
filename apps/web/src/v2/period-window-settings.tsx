import { v2PeriodWindowLimits, type V2PeriodWindow } from '@ntfs/contracts';
import { Feedback } from './controls';

type Props = {
  value: V2PeriodWindow; editable: boolean; dirty: boolean; busy: boolean; conflict: boolean; error: string;
  onChange: (counts: { before: number; after: number }) => void;
  onSave: () => void; onCancel: () => void;
};

/** 团队展示数量独立保存；加减只改变窗口草稿，日期边界另行确认。 */
export function PeriodWindowSettings({ value, editable, dirty, busy, conflict, error, onChange, onSave, onCancel }: Props) {
  return <section className="v2-period-window" aria-label="团队展示窗口">
    <p className="v2-context">团队共用展示范围，随当前区间滚动；收起不会删除任务和历史记录。{!editable && '由团队负责人调整。'}</p>
    <div className="v2-period-window-controls">
      {(['before', 'after'] as const).map((side) => {
        const label = side === 'before' ? '前面' : '后面';
        return <div className="w-row" key={side}><span>{label}</span><button className="w-button" aria-label={`减少${label}区间`} disabled={!editable || busy || value[side] === 0} onClick={() => onChange({ before: value.before, after: value.after, [side]: value[side] - 1 })}>−</button><output aria-label={`${label}区间数量`}>{value[side]} 个区间</output><button className="w-button" aria-label={`增加${label}区间`} disabled={!editable || busy || value[side] === v2PeriodWindowLimits.max} onClick={() => onChange({ before: value.before, after: value.after, [side]: value[side] + 1 })}>＋</button></div>;
      })}
      <span>含当前区间，共 {value.before + 1 + value.after} 个</span>
    </div>
    {editable && <div className="v2-period-window-controls"><button className="w-button" disabled={busy || (value.before === v2PeriodWindowLimits.before && value.after === v2PeriodWindowLimits.after)} onClick={() => onChange({ before: v2PeriodWindowLimits.before, after: v2PeriodWindowLimits.after })}>恢复默认</button><button className="w-button primary" disabled={!dirty || busy || conflict} onClick={onSave}>{busy ? '正在保存…' : '保存窗口'}</button>{dirty && <button className="w-button" disabled={busy} onClick={onCancel}>{conflict ? '读取最新窗口' : '撤销窗口修改'}</button>}</div>}
    {dirty && <p className="v2-context">保存后全团队生效，缺少的日期区间会自动补齐。</p>}
    {conflict && <p role="alert" className="v2-error">团队窗口已被其他负责人修改，请读取最新窗口后重新调整。</p>}
    <Feedback error={error} />
  </section>;
}
