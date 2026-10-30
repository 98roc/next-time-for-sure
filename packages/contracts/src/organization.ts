import { z } from 'zod';
import { loginNameSchema, passwordSchema } from './identity.js';

const id = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const version = z.number().int().nonnegative();
export const projectRoleSchema = z.enum(['project_manager', 'project_lead', 'developer']);

/** 管理命令外部输入契约；版本用于防止覆盖已保存的组织安排。 */
export const organizationCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_account'), loginName: loginNameSchema, displayName: name, password: passwordSchema, isSuperAdmin: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('create_member'), teamId: id, loginName: loginNameSchema, displayName: name, password: passwordSchema }).strict(),
  z.object({ action: z.literal('update_account'), accountId: id, loginName: loginNameSchema, displayName: name, version, isSuperAdmin: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('delete_account'), accountId: id, version }).strict(),
  z.object({ action: z.literal('create_team'), name, leaderId: id }).strict(),
  z.object({ action: z.literal('update_team'), teamId: id, name, leaderId: id, version }).strict(),
  z.object({ action: z.literal('delete_team'), teamId: id, version }).strict(),
  z.object({ action: z.literal('link_member'), teamId: id, loginName: loginNameSchema }).strict(),
  z.object({ action: z.literal('set_leader'), teamId: id, accountId: id, version }).strict(),
  z.object({ action: z.literal('reset_password'), accountId: id, password: passwordSchema, version }).strict(),
  z.object({ action: z.literal('set_disabled'), accountId: id, disabled: z.boolean(), version }).strict(),
]);
export type OrganizationCommand = z.infer<typeof organizationCommandSchema>;

export const directoryAccountSchema = z.object({ id, loginName: loginNameSchema, displayName: name, teamId: id.nullable(), disabled: z.boolean(), version, isSuperAdmin: z.boolean().optional() });
export const teamSchema = z.object({ id, name, leaderId: id, version });
export const projectSchema = z.object({ id, teamId: id, name, version, members: z.array(z.object({ accountId: id, roles: z.array(projectRoleSchema) })) });
export const organizationSnapshotSchema = z.object({
  accounts: z.array(directoryAccountSchema), teams: z.array(teamSchema), projects: z.array(projectSchema),
});
export type OrganizationSnapshot = z.infer<typeof organizationSnapshotSchema>;
