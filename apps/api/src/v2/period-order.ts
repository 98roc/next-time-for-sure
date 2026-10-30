import type { EntityManager } from 'typeorm';
import type { V2Period } from '@ntfs/contracts';
import { V2TaskRepository } from './task.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { summarizePeriod } from './history.js';
import { compareTaskOrder, newestTaskIds } from './sorting.js';
import { V2PlanningLabelsRepository } from './planning-labels.repository.js';

/** 总结和安排先合并完整区间作用域，再按视角或人员投影，不丢失另一个视角的位置。 */
export async function periodOrderSource(manager: EntityManager, projectId: string, period: V2Period) {
  const tasks = new V2TaskRepository(manager), planning = new V2PlanningRepository(manager);
  const all = await tasks.projectOrderTasks([projectId]), ids = all.map((row) => row.id);
  const summary = summarizePeriod(period, await tasks.history(ids), await planning.arrangementHistory(ids), new Date().toISOString(), await new V2PlanningLabelsRepository(manager).read(ids));
  const arrangements = await tasks.arrangements(all.filter((row) => !row.deletedAt).map((row) => row.id));
  const plan = all.filter((task) => arrangements.some((row) => row.taskId === task.id && row.periodId === period.id));
  const candidates = new Map<string, { id: string; priority: number | null; createdAt: string | null }>(plan.map((row) => [row.id, { id: row.id, priority: row.priority, createdAt: row.createdAt }]));
  for (const row of summary) candidates.set(row.taskId, { id: row.taskId, priority: row.priority, createdAt: row.createdAt });
  return { newestIds: newestTaskIds([...candidates.values()]), ids: [...candidates.values()].sort(compareTaskOrder).map((row) => row.id), summary, plan };
}
