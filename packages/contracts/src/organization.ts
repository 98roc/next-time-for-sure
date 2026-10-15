import { z } from 'zod';
import { loginNameSchema, passwordSchema } from './identity.js';

/** 预设角色固定，首期不开放权限配置。 */
export const roleSchema = z.enum(['team_leader', 'group_leader', 'project_manager', 'project_lead', 'developer']);
export type Role = z.infer<typeof roleSchema>;
export const permissionSchema = z.enum(['members.manage', 'groups.manage', 'projects.manage', 'work.assign', 'requests.accept', 'milestones.manage', 'reports.publish', 'requests.submit', 'tasks.create']);
export type Permission = z.infer<typeof permissionSchema>;
export const defaultPermissions: Record<Role, Permission[]> = {
  team_leader: ['members.manage', 'groups.manage', 'projects.manage', 'work.assign', 'requests.accept', 'milestones.manage', 'reports.publish'],
  group_leader: ['work.assign'], project_manager: [], project_lead: ['requests.accept', 'milestones.manage'], developer: [],
};
/** 当前固定权限包含需求与任务阶段新增操作；旧策略表不再参与授权。 */
export const fixedPermissions: Record<Role, Permission[]> = {
  ...defaultPermissions,
  team_leader: [...defaultPermissions.team_leader, 'requests.submit', 'tasks.create'],
  project_manager: ['requests.submit'],
  project_lead: [...defaultPermissions.project_lead, 'tasks.create'],
  developer: ['tasks.create'],
};
const id = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const version = z.number().int().nonnegative();
export const projectRoleSchema = z.enum(['project_manager', 'project_lead', 'developer']);

/** 管理命令外部输入契约；版本用于防止覆盖已保存的组织安排。 */
export const organizationCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_account'), loginName: loginNameSchema, displayName: name, password: passwordSchema }).strict(),
  z.object({ action: z.literal('create_member'), teamId: id, loginName: loginNameSchema, displayName: name, password: passwordSchema }).strict(),
  z.object({ action: z.literal('update_account'), accountId: id, loginName: loginNameSchema, displayName: name, version }).strict(),
  z.object({ action: z.literal('delete_account'), accountId: id, version }).strict(),
  z.object({ action: z.literal('create_team'), name, leaderId: id }).strict(),
  z.object({ action: z.literal('update_team'), teamId: id, name, leaderId: id, version }).strict(),
  z.object({ action: z.literal('delete_team'), teamId: id, version }).strict(),
  z.object({ action: z.literal('link_member'), teamId: id, loginName: loginNameSchema }).strict(),
  z.object({ action: z.literal('set_leader'), teamId: id, accountId: id, version }).strict(),
  z.object({ action: z.literal('create_group'), teamId: id, name, leaderId: id, memberIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ action: z.literal('update_group'), groupId: id, name, leaderId: id, memberIds: z.array(id).min(1).max(100), version }).strict(),
  z.object({ action: z.literal('create_project'), teamId: id, name, managerId: id, leadId: id, developerIds: z.array(id).max(100) }).strict(),
  z.object({ action: z.literal('set_project_member'), projectId: id, accountId: id, roles: z.array(projectRoleSchema).min(1).max(3), version }).strict(),
  z.object({ action: z.literal('set_project_members'), projectId: id, version, members: z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema).min(1).max(3).refine((roles) => new Set(roles).size === roles.length, '角色不能重复') }).strict()).min(1).max(100).refine((members) => new Set(members.map((member) => member.accountId)).size === members.length, '成员不能重复') }).strict(),
  z.object({ action: z.literal('reset_password'), accountId: id, password: passwordSchema, version }).strict(),
  z.object({ action: z.literal('set_disabled'), accountId: id, disabled: z.boolean(), version }).strict(),
]);
export type OrganizationCommand = z.infer<typeof organizationCommandSchema>;

export const directoryAccountSchema = z.object({ id, loginName: loginNameSchema, displayName: name, teamId: id.nullable(), disabled: z.boolean(), version });
export const teamSchema = z.object({ id, name, leaderId: id, version });
export const groupSchema = z.object({ id, teamId: id, name, leaderId: id, memberIds: z.array(id), version });
export const projectSchema = z.object({ id, teamId: id, name, version, archived: z.boolean().default(false), members: z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema) })) });
export const rolePolicySchema = z.object({ role: roleSchema, permissions: z.array(permissionSchema), version });
export const organizationSnapshotSchema = z.object({
  accounts: z.array(directoryAccountSchema), teams: z.array(teamSchema), groups: z.array(groupSchema), projects: z.array(projectSchema), policies: z.array(rolePolicySchema),
});
export type OrganizationSnapshot = z.infer<typeof organizationSnapshotSchema>;
