import { z } from 'zod';

/** 账号名称用于登录，展示名称单独维护。 */
export const loginNameSchema = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/);
/** 新设密码必须同时包含数字、英文大写和小写字母；允许额外符号。 */
export const passwordMinLength = 8;
export const passwordMaxLength = 128;
export const passwordPattern = /(?=[\s\S]*[0-9])(?=[\s\S]*[A-Z])(?=[\s\S]*[a-z])[\s\S]*/;
export const passwordHint = '8～128 个字符，须包含数字、大写和小写字母。';
export const passwordSchema = z.string().min(passwordMinLength).max(passwordMaxLength).regex(passwordPattern, passwordHint);
export const loginSchema = z.object({ loginName: loginNameSchema, password: z.string().min(1).max(128) }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();

/** 客户端只能取得公开账号信息及CSRF校验值，不能取得会话凭据。 */
export const identitySchema = z.object({
  id: z.string().uuid(), loginName: loginNameSchema, displayName: z.string(),
  isSuperAdmin: z.boolean(), mustChangePassword: z.boolean(), csrfToken: z.string(),
});
export type Identity = z.infer<typeof identitySchema>;
export const apiErrorSchema = z.object({ message: z.string() });
