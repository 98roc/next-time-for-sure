import type { EntityManager } from 'typeorm';

/** 团队状态写入集中管理，不更新分工和个人事项的执行字段。 */
export class TaskRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 首次开始保留原时间；重开不会自动开始，不伪造开始时间。 */
  async transition(id: string, action: 'start_task' | 'complete_task' | 'cancel_task' | 'reopen_task', inherited = false): Promise<void> {
    const status = action === 'start_task' ? "'in_progress'" : action === 'complete_task' ? "'completed'" : action === 'cancel_task' ? "'cancelled'" : "IF(started_at IS NULL, 'not_started', 'in_progress')";
    const times = action === 'start_task' ? ', started_at = COALESCE(started_at, UTC_TIMESTAMP(3))' : action === 'reopen_task' ? ', ended_at = NULL' : action === 'complete_task' && !inherited ? ', ended_at = UTC_TIMESTAMP(3)' : '';
    await this.manager.query(`UPDATE team_tasks SET status = ${status}${times}, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
  }
  /** 更换责任身份不创建分工，不调整当前执行事实。 */
  async owner(id: string, owner: string): Promise<void> { await this.manager.query('UPDATE team_tasks SET owner_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [owner, id]); }
  /** 累计进度不按子任务数量推算，100也不自动整体结束。 */
  async progress(id: string, value: number): Promise<void> { await this.manager.query('UPDATE team_tasks SET progress = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [value, id]); }
}
