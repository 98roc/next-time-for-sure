import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';
import { milestoneSchema } from '@ntfs/contracts';

const select = "SELECT id,project_id AS projectId,owner_id AS ownerId,title,DATE_FORMAT(expected_on,'%Y-%m-%d') AS expectedOn,status,version FROM project_milestones";

/** 独立规划目标的数据访问；所有写入由服务校验权限和版本。 */
export class MilestoneRepository {
  constructor(private readonly manager: EntityManager) {}
  /** 读取项目目标，包含移出历史。 */
  async list(project: string) { return z.array(milestoneSchema).parse(await this.manager.query(`${select} WHERE project_id=? ORDER BY created_at,id`, [project])); }
  /** 锁定目标用于并发校验。 */
  async get(id: string) { return z.array(milestoneSchema).parse(await this.manager.query(`${select} WHERE id=? FOR UPDATE`, [id]))[0]; }
  /** 仅创建规划目标，不生成任务。 */
  async create(project: string, owner: string, title: string, date: string | null) {
    const id = randomUUID();
    await this.manager.query('INSERT INTO project_milestones (id,project_id,owner_id,title,expected_on,created_at,updated_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [id, project, owner, title, date]);
    return id;
  }
  /** 保存名称和负责人，使旧版本失效。 */
  async edit(id: string, title: string, owner: string) { await this.manager.query('UPDATE project_milestones SET title=?,owner_id=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [title, owner, id]); }
  /** 目标日期变化不覆盖任务自身日期。 */
  async reschedule(id: string, date: string | null) { await this.manager.query('UPDATE project_milestones SET expected_on=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [date, id]); }
  /** 维护目标状态，保留对象供追溯。 */
  async status(id: string, status: 'open' | 'completed' | 'removed') { await this.manager.query('UPDATE project_milestones SET status=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [status, id]); }
  /** 只改变关联，不同步任务日期或执行状态。 */
  async link(task: string, milestone: string | null) { await this.manager.query('UPDATE team_tasks SET milestone_id=?,in_milestone=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [milestone, milestone ? 1 : 0, task]); }
  /** 移出目标保留全部任务及执行记录。 */
  async unlinkAll(id: string) { await this.manager.query('UPDATE team_tasks SET milestone_id=NULL,in_milestone=0,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE milestone_id=?', [id]); }
}
