import type { ReactNode } from 'react';
import { ModalPage, useModal } from './modal';

/** 业务确认页统一取消入口；取消只退出当前确认，保留上一步草稿。 */
export function ConfirmationPage({ title, children, actions, busy = false }: { title: string; children: ReactNode; actions: ReactNode; busy?: boolean }) {
  const modal = useModal();
  return <ModalPage title={title} busy={busy} hideCloseAction onClose={modal.finish} actions={<><button disabled={busy} onClick={modal.finish}>取消</button>{actions}</>}>{children}</ModalPage>;
}
