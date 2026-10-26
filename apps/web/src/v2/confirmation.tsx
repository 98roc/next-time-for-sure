import { useQueries } from '@tanstack/react-query';
import type { V2ImpactIntent } from '@ntfs/contracts';
import { readImpact } from './api';
import { useModal } from './modal';
import { ConfirmationPage } from './confirmation-page';
import { Feedback, useAction } from './controls';

/** 真实影响与阻塞原因在同层展示，过期确认由服务端拒绝并保留当前草稿。 */
export function Confirmation({ intent, label, onConfirm, onDone, danger = false }: { intent: V2ImpactIntent; label: string; onConfirm: (confirmation: string) => Promise<unknown>; onDone?: () => void; danger?: boolean }) {
  return <Confirmations intents={[intent]} label={label} danger={danger} {...(onDone ? { onDone } : {})} onConfirm={async (confirmations) => { const first = confirmations[0]; if (first) await onConfirm(first); }} />;
}

/** 合并保存的多项影响在同一视图确认，提交仍为一次事务，不逐条修改任务。 */
export function Confirmations({ intents, label, onConfirm, onDone, danger = false }: { intents: V2ImpactIntent[]; label: string; onConfirm: (confirmations: string[]) => Promise<unknown>; onDone?: () => void; danger?: boolean }) {
  const queries = useQueries({ queries: intents.map((intent) => ({ queryKey: ['v2', 'impact', intent], queryFn: () => readImpact(intent), retry: false, staleTime: 0 })) });
  const action = useAction(), modal = useModal();
  const ready = queries.every((query) => query.data && !query.data.blockers.length && !query.isFetching && !query.error);
  return <ConfirmationPage title={label} busy={action.busy} actions={<button className={danger ? 'v2-danger' : 'nt-primary'} disabled={!ready || action.busy} onClick={() => { if (ready) void action.act(async () => { await onConfirm(queries.flatMap((query) => query.data ? [query.data.confirmation] : [])); (onDone ?? modal.finish)(); }); }}>{label.startsWith('确认') ? label : `确认${label}`}</button>}>
    {queries.map((query, index) => <section key={index}>{query.isPending && <p role="status">正在核对操作影响…</p>}{query.error && <Feedback error={query.error.message} />}{query.data && <><h3>{query.data.title}</h3><ul>{query.data.details.map((detail, position) => <li key={position}>{detail}</li>)}</ul>{query.data.blockers.map((reason) => <p className="v2-error" key={reason}>{reason}</p>)}</>}</section>)}<Feedback error={action.error} />{(queries.some((query) => query.error) || action.error) && <button onClick={() => { action.clear(); for (const query of queries) void query.refetch(); }}>重新核对影响</button>}
  </ConfirmationPage>;
}
