import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { V2Arrangement, V2Period, V2Task } from '@ntfs/contracts';
import { z } from 'zod';
import { V2PlanningRepository } from './planning.repository.js';
import { V2TaskRepository } from './task.repository.js';
import { shanghaiDate, shiftDate } from './calendar.js';

/** 未完成且无当前/未来安排才顺延；已有后续人工计划时不填充中间空档。 */
export function rolloverSource(task: V2Task, rows: V2Arrangement[], periods: V2Period[], current: V2Period): V2Arrangement | undefined {
  if (task.kind !== 'project' || task.deletedAt || task.status === 'completed') return;
  const relevant = rows.filter((row) => row.taskId === task.id);
  if (relevant.some((row) => periods.some((period) => period.id === row.periodId && period.startOn >= current.startOn))) return;
  return relevant.filter((row) => periods.some((period) => period.id === row.periodId && period.endOn < current.startOn))
    .sort((a, b) => (periods.find((p) => p.id === b.periodId)?.startOn ?? '').localeCompare(periods.find((p) => p.id === a.periodId)?.startOn ?? '')).at(0);
}

/** 调用前持有组织事务锁；只补当前周期，不凭当前状态倒造漏运行期间的历史排期。 */
export async function rolloverTeam(manager: EntityManager, teamId: string, now = new Date().toISOString()): Promise<void> {
  const planning = new V2PlanningRepository(manager), tasks = new V2TaskRepository(manager), today = shanghaiDate(now);
  await planning.ensure(teamId, today);
  const periods = await planning.periods(teamId);
  let last = periods.at(-1), extended = false;
  while (last && last.endOn < shiftDate(today, 7)) {
    const next: V2Period = { id: randomUUID(), teamId, startOn: shiftDate(last.endOn, 1), endOn: shiftDate(last.endOn, 7), version: 0 };
    await planning.insertPeriod(next); periods.push(next); last = next; extended = true;
  }
  if (extended) await planning.bump(teamId);
  const current = periods.find((period) => period.startOn <= today && period.endOn >= today);
  if (!current) return;
  const projects = z.array(z.object({ id: z.string() })).parse(await manager.query('SELECT id FROM projects WHERE team_id=?', [teamId]));
  const all = await tasks.projectOrderTasks(projects.map((row) => row.id));
  const rows = await tasks.arrangements(all.map((row) => row.id));
  const history = await planning.arrangementHistory(all.map((row) => row.id));
  for (const task of all) {
    const source = rolloverSource(task, rows, periods, current);
    // 人工撤销过本期安排不自动加回；同事务多实例及重复轮询不产生重复项。
    if (!source || history.some((row) => row.taskId === task.id && row.periodId === current.id)) continue;
    await tasks.addArrangement(task, current.id, source.plannedDays, null, now, '', source.periodId);
    await tasks.update(task, { ...task, updatedAt: now, version: task.version + 1 }, null, 'arrangement_carried');
  }
}
