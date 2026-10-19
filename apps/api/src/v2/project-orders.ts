import { newestTaskIds } from './sorting.js';
import type { EntityManager } from 'typeorm';
import type { V2Context } from './context.js';
import { V2PlanningRepository } from './planning.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { V2ProjectRepository } from './project.repository.js';

/** 项目页任务含删除后的历史标识，使历史汇总与当前列表使用同一项目顺序。 */
export async function projectItemIds(manager: EntityManager, projectId: string, target: 'tasks' | 'backlog') {
  const rows = target === 'backlog' ? await new V2ProjectRepository(manager).backlog([projectId]) : await new V2TaskRepository(manager).projectOrderTasks([projectId]);
  return { ids: rows.map((row) => row.id), newestIds: newestTaskIds(rows) };
}

/** 项目页顺序独立于周计划；全团队项目先合并再投影，受限读取不删除隐藏对象。 */
export async function readProjectOrders(manager: EntityManager, context: V2Context) {
  if (!context.teamId) return [];
  const repository = new V2PlanningRepository(manager);
  const all = context.organization.projects.filter((row) => row.teamId === context.teamId).map((row) => row.id);
  const projects = await repository.order(context.teamId, 'project-page:projects', all);
  const result = [{ scope: 'project-page:projects', ...projects, ids: projects.ids.filter((id) => context.projects.some((row) => row.id === id)) }];
  for (const project of context.projects) for (const target of ['tasks', 'backlog'] as const) {
    const scope = `project-page:${target}:${project.id}`;
    const source = await projectItemIds(manager, project.id, target);
    result.push({ scope, ...await repository.order(context.teamId, scope, source.ids, source.newestIds) });
  }
  return result;
}
