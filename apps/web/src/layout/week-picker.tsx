/** 以本地日历计算周一；不让用户承担“必须选择周一”的数据约束。 */
export function weekStart(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localDate(date);
}

/** 日期采用本地年月日，避免时区转换改变用户选择。 */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 操作文案随选中周变化，避免下周仍标注“本周”。 */
export function weekLabel(week: string): string {
  const current = weekStart(localDate());
  return week === current ? '本周' : week === shiftWeek(current, 1) ? '下周' : `${week} 当周`;
}

/** 使用本地日历移动整周，兼容跨月、跨年与夏令时。 */
export function shiftWeek(week: string, amount: number): string {
  const date = new Date(`${week}T12:00:00`);
  date.setDate(date.getDate() + amount * 7);
  return localDate(date);
}

/** 周次导航允许选任意一天，向接口提交所属周的周一。 */
export function WeekPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const shift = (days: number) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); onChange(localDate(date)); };
  const end = new Date(`${value}T12:00:00`); end.setDate(end.getDate() + 6);
  return <div className="week-picker"><button aria-label="上一周" onClick={() => shift(-7)}>←</button><label><span className="sr-only">选择周次</span><input aria-label="选择这一周中的任意日期" type="date" value={value} onInput={(event) => { if (event.currentTarget.value) onChange(weekStart(event.currentTarget.value)); }} /></label><span>至 {localDate(end)}</span><button aria-label="下一周" onClick={() => shift(7)}>→</button><button onClick={() => onChange(weekStart(localDate()))}>本周</button><button onClick={() => { const next = new Date(); next.setDate(next.getDate() + 7); onChange(weekStart(localDate(next))); }}>下周</button></div>;
}
