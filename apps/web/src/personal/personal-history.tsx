import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PersonalItem } from '@ntfs/contracts';
import { personalHistory } from './api';

const labels: Record<string, string> = { create_personal: '创建事项', edit_personal: '修改内容与检查清单', link_personal: '调整本人关联', manage_link: '管理者调整关联', start_personal: '开始或恢复执行', complete_personal: '完成本人事项', personal_progress: '记录进展', personal_times: '修正实际时间', move_personal: '移动分类', insert_personal: '调整分类与顺序' };
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '未记录';

/** 展开后才加载本人的变更历史，保留历次结束、恢复和时间修正的可见证据。 */
export function PersonalHistory({ item }: { item: PersonalItem }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({ queryKey: ['personal', 'history', item.ownerId, item.id, item.version], queryFn: () => personalHistory(item.id), enabled: open });
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>本人变更历史</summary>
    {history.isPending && <p role="status">正在读取历史…</p>}
    {history.isError && <p role="alert">{history.error.message}<button onClick={() => { void history.refetch(); }}>重试</button></p>}
    <ol>{history.data?.map((entry) => {
      const { before, after } = entry.payload;
      return <li key={entry.id}><p>{new Date(entry.createdAt).toLocaleString('zh-CN')} · {labels[entry.action] ?? '事项变更'}</p>
        {before && after && (before.startedAt !== after.startedAt || before.endedAt !== after.endedAt) && <p>开始：{time(before.startedAt)} → {time(after.startedAt)}<br />结束：{time(before.endedAt)} → {time(after.endedAt)}</p>}
      </li>;
    })}</ol>
  </details>;
}
