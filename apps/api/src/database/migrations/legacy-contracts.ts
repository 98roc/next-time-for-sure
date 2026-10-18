import { z } from 'zod';

/** 冻结已执行迁移的输入；仅用于从空库重放 V1，不参与当前业务授权。 */
export const defaultPermissions = {
  team_leader: ['members.manage', 'groups.manage', 'projects.manage', 'work.assign', 'requests.accept', 'milestones.manage', 'reports.publish'],
  group_leader: ['work.assign'], project_manager: [], project_lead: ['requests.accept', 'milestones.manage'], developer: [],
};
export const personalStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);
export const personalStatusLabels = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };
