import { z } from 'zod';
import { loginNameSchema, passwordSchema } from './identity.js';

/** 预设角色固定，允许配置操作但不创建角色或解除固定数据边界。 */
export const roleSchema = z.enum(['team_leader', 'group_leader', 'project_manager', 'project_lead', 'developer']);
export type Role = z.infer<typeof roleSchema>;
export const permissionSchema = z.enum(['members.manage', 'groups.manage', 'projects.manage', 'work.assign', 'requests.accept', 'milestones.manage', 'reports.publish', 'requests.submit', 'tasks.create']);
export type Permission = z.infer<typeof permissionSchema>;
export const defaultPermissions: Record<Role, Permission[]> = {
  team_leader: ['members.manage', 'groups.manage', 'projects.manage', 'work.assign', 'requests.accept', 'milestones.manage', 'reports.publish'],
  group_leader: ['work.assign'], project_manager: [], project_lead: ['requests.accept', 'milestones.manage'], developer: [],
};
const id = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const version = z.number().int().nonnegative();
export const projectRoleSchema = z.enum(['project_manager', 'project_lead', 'developer']);

/** 管理命令外部输入契约；版本用于防止覆盖已保存的组织安排。 */
export const organizationCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_team'), name, leader: z.object({ loginName: loginNameSchema, displayName: name, password: passwordSchema }).strict() }).strict(),
  z.object({ action: z.literal('create_member'), teamId: id, loginName: loginNameSchema, displayName: name, password: passwordSchema }).strict(),
  z.object({ action: z.literal('link_member'), teamId: id, loginName: loginNameSchema }).strict(),
  z.object({ action: z.literal('set_leader'), teamId: id, accountId: id, version }).strict(),
  z.object({ action: z.literal('create_group'), teamId: id, name, leaderId: id, memberIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ action: z.literal('update_group'), groupId: id, name, leaderId: id, memberIds: z.array(id).min(1).max(100), version }).strict(),
  z.object({ action: z.literal('create_project'), teamId: id, name, managerId: id, leadId: id, developerIds: z.array(id).max(100) }).strict(),
  z.object({ action: z.literal('set_project_member'), projectId: id, accountId: id, roles: z.array(projectRoleSchema).min(1).max(3), version }).strict(),
  z.object({ action: z.literal('reset_password'), accountId: id, password: passwordSchema, version }).strict(),
  z.object({ action: z.literal('set_disabled'), accountId: id, disabled: z.boolean(), version }).strict(),
  z.object({ action: z.literal('set_role_permissions'), role: roleSchema, permissions: z.array(permissionSchema).max(permissionSchema.options.length), version }).strict(),
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
