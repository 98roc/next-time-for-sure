import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { readMessages, readWorkspace } from './api';
import { ModalPage, useModal } from './modal';
import { useWorkspace } from './workspace';
import { TaskEditor } from './task-editor';
import './messages.css';

/** 兼容已保存的消息说明，提取事件标签；未知说明保留，避免隐藏后端新增事件。 */
function messagePresentation(reasons: string[]) {
  const labels = new Set<string>(), details: string[] = [];
  for (const reason of reasons) {
    if (reason.endsWith('为你安排了任务')) labels.add('分配给我');
    else if (reason.endsWith('新增了计划外任务') || reason.endsWith('标记了计划外任务')) labels.add('计划外');
    else if (reason.endsWith('完成了任务')) {
      labels.add('已完成');
    } else details.push(reason);
  }
  return { labels: [...labels], details };
}

/** 右上角消息入口无红点；系统通知深链只接受任务标识，访问时重新读取权限。 */
export function MessagesButton() {
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const handled = useRef('');
  const target = params.get('messageTask') ?? '';
  const list = params.get('messages') === '1';
  useEffect(() => {
    const key = target || (list ? 'list' : '');
    if (!key || handled.current === key) return;
    handled.current = key;
    modal.open(target ? <MessageTask taskId={target} /> : <MessagesDialog />);
    const next = new URLSearchParams(params);
    next.delete('messageTask'); next.delete('messages'); setParams(next, { replace: true });
  }, [target, list, modal, params, setParams]);
  return <button className="v2-messages-button" aria-label="消息" title="消息" onClick={() => modal.open(<MessagesDialog />)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
  </button>;
}

/** 最新消息优先，每页十条；切页保留明确的加载、错误及重试反馈。 */
function MessagesDialog() {
  const { user } = useWorkspace(), modal = useModal();
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['v2', 'messages', user.id, page], queryFn: () => readMessages(page), refetchInterval: 15000, retry: false });
  const data = query.data;
  const pagination = data && data.total > 10 ? <div className="v2-message-pagination">
    <button aria-label="上一页消息" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>上一页</button>
    <span>{data.page} / {Math.ceil(data.total / 10)}</span>
    <button aria-label="下一页消息" disabled={data.page * 10 >= data.total} onClick={() => setPage(data.page + 1)}>下一页</button>
  </div> : undefined;
  return <ModalPage title="消息" subtitle="最近7天" compact hideCloseAction actions={pagination}>
    {query.isError ? <div role="alert">消息加载失败：{query.error.message}<button onClick={() => { void query.refetch(); }}>重试</button></div> : !data ? <p role="status">正在加载消息…</p> : <>
      {!data.messages.length && <div className="v2-message-empty">暂无消息</div>}
      <ul className="v2-messages-list">{data.messages.map((message) => <li key={message.id}>
        {message.items.map((item) => {
          const presentation = messagePresentation(item.reasons);
          return <div className="v2-message-item" key={item.taskId}>
            <div className="v2-message-heading">
              <button className="nt-link" onClick={() => modal.push(<MessageTask taskId={item.taskId} />)}>{item.title}</button>
              <span className="v2-message-tags">{presentation.labels.map((label) => <span className="v2-message-tag" key={label}>{label}</span>)}</span>
            </div>
            <div className="v2-message-meta"><span>{item.projectName}</span><span aria-hidden="true">·</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
            {presentation.details.length > 0 && <span className="v2-message-detail">{presentation.details.join('；')}</span>}
          </div>;
        })}
      </li>)}</ul>
    </>}
  </ModalPage>;
}

/** 消息中的历史名称不授予任务权限；删除、移出项目或会话失效时不打开旧快照。 */
function MessageTask({ taskId }: { taskId: string }) {
  const { user } = useWorkspace();
  const query = useQuery({ queryKey: ['message-target', user.id, taskId], queryFn: readWorkspace, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false });
  if (query.isFetching) return <ModalPage title="任务"><p role="status">正在核验任务…</p></ModalPage>;
  if (query.isError) return <ModalPage title="任务"><p role="alert">{query.error.message}</p><button onClick={() => { void query.refetch(); }}>重试</button></ModalPage>;
  const task = query.data?.tasks.find((row) => row.id === taskId);
  return task ? <TaskEditor task={task} /> : <ModalPage title="任务不可访问"><p>任务已删除或你已无权访问。</p></ModalPage>;
}
