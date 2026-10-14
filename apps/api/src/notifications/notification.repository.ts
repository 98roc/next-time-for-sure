import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { notificationPayloadSchema, notificationSchema } from '@ntfs/contracts';
import type { WorkAccess } from '../work/work-access.js';

/** 事件与业务同事务创建；投递可重放，同用户唯一约束兜底。 */
export class NotificationRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 不输出私人内容；收件人在事件发生时确定，展示时再校验当前权限。 */
  async enqueue(team: string, project: string | null, recipients: string[], title: string, objectId: string, path: string, eventId: string = randomUUID()) {
    const payload = notificationPayloadSchema.parse({ recipients: [...new Set(recipients)], title, objectId, path });
    if (!payload.recipients.length) return;
    await this.manager.query('INSERT IGNORE INTO notification_outbox (id,team_id,project_id,payload_json,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [eventId, team, project, JSON.stringify(payload)]);
  }
  /** 在组织事务锁内投递。中断回滚，待投递行保留，由下一轮读取重试。 */
  async deliver() {
    const rows: unknown = await this.manager.query('SELECT id,team_id AS teamId,payload_json FROM notification_outbox WHERE delivered=0 ORDER BY created_at LIMIT 100 FOR UPDATE');
    for (const row of z.array(z.object({ id: z.string(), teamId: z.string(), payload_json: z.unknown() })).parse(rows)) {
      const payload = notificationPayloadSchema.parse(decode(row.payload_json));
      await this.manager.query('UPDATE notification_outbox SET attempts=attempts+1 WHERE id=?', [row.id]);
      for (const recipient of payload.recipients) await this.manager.query('INSERT IGNORE INTO notifications (id,event_id,account_id,created_at) SELECT ?,?,?,UTC_TIMESTAMP(3) FROM accounts WHERE id=? AND team_id=? AND disabled=0', [randomUUID(), row.id, recipient, recipient, row.teamId]);
      await this.manager.query('UPDATE notification_outbox SET delivered=1 WHERE id=?', [row.id]);
    }
  }
  /** 多端共用同一已读字段，成员移出后不再返回原团队提示。 */
  async list(access: WorkAccess) {
    const rows: unknown = await this.manager.query("SELECT n.id,n.event_id AS eventId,o.project_id AS projectId,o.payload_json,DATE_FORMAT(n.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(n.read_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS readAt FROM notifications n JOIN notification_outbox o ON o.id=n.event_id WHERE n.account_id=? AND o.team_id=? ORDER BY n.created_at DESC LIMIT 200", [access.actor.id, access.actor.teamId]);
    const parsed = z.array(z.object({ id: z.string(), eventId: z.string(), projectId: z.string().nullable(), payload_json: z.unknown(), createdAt: z.string(), readAt: z.string().nullable() })).parse(rows);
    const groupRows: unknown = await this.manager.query('SELECT a.id,t.project_id AS projectId FROM task_assignments a JOIN team_tasks t ON t.id=a.task_id JOIN work_groups g ON g.id=a.group_id WHERE g.leader_id=? AND g.team_id=?', [access.actor.id, access.actor.teamId]);
    const groupAssignments = z.array(z.object({ id: z.string(), projectId: z.string() })).parse(groupRows);
    return parsed.filter((row) => !row.projectId || access.organization.teams.some((team) => team.id === access.actor.teamId && team.leaderId === access.actor.id) || access.organization.projects.some((project) => project.id === row.projectId && project.members.some((member) => member.accountId === access.actor.id)) || groupAssignments.some((assignment) => assignment.projectId === row.projectId && assignment.id === notificationPayloadSchema.parse(decode(row.payload_json)).objectId)).map((row) => { const payload = notificationPayloadSchema.parse(decode(row.payload_json)); return notificationSchema.parse({ ...row, title: payload.title, path: payload.path }); });
  }
  /** 已读重复请求保持首次时间，不因桌面展示而调用。 */
  async read(id: string, actor: string) { await this.manager.query('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE id=? AND account_id=?', [id, actor]); }
}
/** 驱动兼容字符串JSON和对象JSON。 */
function decode(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
