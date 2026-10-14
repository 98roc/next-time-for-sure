import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { NotificationRepository } from './notification.repository.js';

/** 已发布周报收到新进展时提醒团队负责人；不复制进展内容或自动修订。 */
export async function notifyLateProgress(manager: EntityManager, project: string, week: string, sourceId: string) {
  const rows: unknown = await manager.query("SELECT t.id AS teamId,t.leader_id AS leaderId FROM projects p JOIN teams t ON t.id=p.team_id WHERE p.id=? AND EXISTS (SELECT 1 FROM weekly_publications w WHERE w.team_id=t.id AND w.week=? AND w.kind='report')", [project, week]);
  const scope = z.array(z.object({ teamId: z.string(), leaderId: z.string() })).parse(rows)[0];
  if (scope) await new NotificationRepository(manager).enqueue(scope.teamId, null, [scope.leaderId], `${week} 周报发布后有新增补记，请决定是否修订`, sourceId, `/reports?week=${week}`, sourceId);
}
