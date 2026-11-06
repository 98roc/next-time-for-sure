import type { V2Milestone } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { Confirmation } from './confirmation';
import { useModal } from './modal';
import { useWorkspace } from './workspace';

/** 详情与编辑共用删除入口；服务端核验权限和关联影响，成功后退出整个流程。 */
export function MilestoneDeleteButton({ milestone, disabled = false }: { milestone: V2Milestone; disabled?: boolean }) {
  const modal = useModal(), { run } = useWorkspace();
  const intent = { action: 'delete_milestone' as const, milestoneId: milestone.id, version: milestone.version };
  return <button type="button" className="v2-danger" disabled={disabled} onClick={() => modal.push(<Confirmation label="删除里程碑" danger intent={intent} onConfirm={(confirmation) => run('projects', { ...intent, operationId: createOperationId(), confirmation })} onDone={() => modal.close(true)} />)}>删除里程碑</button>;
}
