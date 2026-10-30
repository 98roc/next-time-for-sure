import type { V2Period } from '@ntfs/contracts';

type PeriodDates = Pick<V2Period, 'startOn' | 'endOn'>;
export type PeriodEditorPeriod = V2Period | (PeriodDates & { id: null });
type PreviewDraft = { original: PeriodDates; edited: PeriodDates };
export type PeriodDateDraft = { today: string; original: V2Period[]; edited: Record<string, V2Period>; previews: Record<string, PreviewDraft> };

/** 已有记录按业务ID编辑，新行按未改动的起始边界维护草稿；恢复原值即清除对应修改。 */
export function editPeriodDate(draft: PeriodDateDraft | null, periods: V2Period[], today: string, row: PeriodEditorPeriod, field: keyof PeriodDates, value: string): PeriodDateDraft | null {
  const current = draft ?? { today, original: periods, edited: {}, previews: {} };
  if (row.id === null) {
    const previous = current.previews[row.startOn];
    const original = previous?.original ?? { startOn: row.startOn, endOn: row.endOn };
    const edited = { ...(previous?.edited ?? original), [field]: value };
    const previews = { ...current.previews, [row.startOn]: { original, edited } };
    if (original.startOn === edited.startOn && original.endOn === edited.endOn) delete previews[row.startOn];
    return Object.keys(previews).length || Object.keys(current.edited).length ? { ...current, previews } : null;
  }

  const original = current.original.find((period) => period.id === row.id) ?? row;
  const next = { ...(current.edited[row.id] ?? row), [field]: value };
  const edited = { ...current.edited, [row.id]: next };
  if (original.startOn === next.startOn && original.endOn === next.endOn) delete edited[row.id];

  // 范围保存后新进入目录的行也固定其原始版本，后续轮询不覆盖草稿。
  const originalRows = current.original.some((period) => period.id === row.id) ? current.original : [...current.original, original];
  return Object.keys(edited).length || Object.keys(current.previews).length ? { ...current, original: originalRows, edited } : null;
}

/** 正式区间创建后按完整原始边界绑定真实ID和版本，日期修改继续走已有影响确认接口。 */
export function bindPreviewDates(draft: PeriodDateDraft | null, periods: V2Period[]): PeriodDateDraft | null {
  if (!draft) return null;
  const matched = Object.entries(draft.previews).flatMap(([key, preview]) => {
    const period = periods.find((row) => row.startOn === preview.original.startOn && row.endOn === preview.original.endOn);
    return period ? [{ key, preview, period }] : [];
  });
  if (!matched.length) return draft;
  const edited = { ...draft.edited }, previews = { ...draft.previews }, original = [...draft.original];
  for (const { key, preview, period } of matched) {
    if (!original.some((row) => row.id === period.id)) original.push(period);
    edited[period.id] = { ...period, ...preview.edited };
    delete previews[key];
  }
  return { ...draft, original, edited, previews };
}
