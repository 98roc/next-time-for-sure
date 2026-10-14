import { useState } from 'react';
import type { PublicationRow, Publication } from '@ntfs/contracts';
import './weekly.css';

/** 已发布历史独立展示，可切换版本及复制完整项目周报。 */
export function Publications({ versions }: { versions: Publication[] }) {
  const [selected, setSelected] = useState(''); const [message, setMessage] = useState('');
  const value = versions.find((entry) => entry.id === selected) ?? versions[0];
  if (!value) return <section className="panel"><h2>已发布版本</h2><p>本周尚未发布。</p></section>;
  const projects = [...new Map([...value.rows, ...value.next].map((row) => [row.projectId, row.projectName])).entries()];
  const text = projects.map(([id, name]) => `${name}\n本周工作\n${lines(value.rows.filter((row) => row.projectId === id))}${value.kind === 'report' ? `\n下周安排\n${lines(value.next.filter((row) => row.projectId === id))}` : ''}`).join('\n\n');
  return <section className="panel weekly-section"><h2>已发布版本</h2><div className="weekly-toolbar"><label>历史版本<select value={value.id} onChange={(event) => { setSelected(event.target.value); setMessage(''); }}>{versions.map((entry) => <option key={entry.id} value={entry.id}>第 {entry.revision} 版 · {new Date(entry.createdAt).toLocaleString('zh-CN')}</option>)}</select></label><button onClick={() => { void navigator.clipboard.writeText(text).then(() => setMessage('已复制。'), () => setMessage('复制失败，请选择下方文字手动复制。')); }}>复制文本</button></div><p>发布说明：{value.reason}</p><p role="status">{message}</p><pre className="weekly-copy">{text || '暂无条目'}</pre></section>;
}
/** 纯文本保留人物、目标和投入，空值明确写成未估算。 */
function lines(rows: PublicationRow[]) { return rows.map((row) => `· ${row.title}${row.person ? `（${row.person}）` : ''}\n${row.text}${row.person ? `；投入${row.plannedDays === null ? '未估算' : `${row.plannedDays}天`}` : ''}`).join('\n') || '暂无安排'; }

/** 按人员跨项目精确累计百分之一天，未估算只计条数不当作零。 */
export function EffortSummary({ rows }: { rows: PublicationRow[] }) {
  const people = new Map<string, { name: string; cents: number; missing: number }>();
  for (const row of rows) {
    if (!row.accountId) continue;
    const sum = people.get(row.accountId) ?? { name: row.person, cents: 0, missing: 0 };
    if (row.plannedDays === null) sum.missing++;
    else { const [whole = '0', fraction = ''] = row.plannedDays.split('.'); sum.cents += Number(whole) * 100 + Number(fraction.padEnd(2, '0')); }
    people.set(row.accountId, sum);
  }
  return <section className="panel"><h2>人员投入汇总</h2><p>按当前可见范围跨项目累计，不作为硬性容量限制。</p>{[...people].map(([id, value]) => <p key={id}>{value.name}：{(value.cents / 100).toFixed(2)} 天，{value.missing} 项未估算</p>)}</section>;
}
