import { z } from 'zod';

/** 账号名称用于登录，展示名称单独维护。 */
export const loginNameSchema = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/);
export const passwordSchema = z.string().min(12).max(128);
export const loginSchema = z.object({ loginName: loginNameSchema, password: z.string().min(1).max(128) }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();

/** 客户端只能取得公开账号信息及CSRF校验值，不能取得会话凭据。 */
export const identitySchema = z.object({
  id: z.string().uuid(), loginName: loginNameSchema, displayName: z.string(),
  isSuperAdmin: z.boolean(), mustChangePassword: z.boolean(), csrfToken: z.string(),
});
export type Identity = z.infer<typeof identitySchema>;
export const apiErrorSchema = z.object({ message: z.string() });
