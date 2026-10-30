import type { EntityManager } from 'typeorm';
import type { V2Context } from './context.js';
import { V2TaskRepository } from './task.repository.js';

/** 跨周期维护完整人员目录，含历史执行人；受限读取仅投影当前可见任务中的人员。 */
export async function weeklyPeopleIds(manager: EntityManager, context: V2Context): Promise<string[]> {
  const projectIds = context.organization.projects.filter((project) => project.teamId === context.teamId).map((project) => project.id);
  const historical = await new V2TaskRepository(manager).projectExecutorIds(projectIds);
  const accounts = context.organization.accounts;
  const ids = [...new Set([...accounts.filter((account) => account.teamId === context.teamId).map((account) => account.id), ...historical])];
  const name = (id: string) => accounts.find((account) => account.id === id)?.displayName ?? '历史成员';
  return ids.sort((a, b) => name(a).localeCompare(name(b), 'zh-CN') || a.localeCompare(b));
}
