import { z } from 'zod';
/** 永久有效必须显式确认；摘要和明文不进入Token列表。 */
export const createTokenSchema = z.object({ name: z.string().trim().min(1).max(100), expiresAt: z.iso.datetime().nullable(), permanentConfirmed: z.boolean() }).strict();
export const revokeTokenSchema = z.object({ id: z.string().uuid() }).strict();
export const personalTokenSchema = z.object({ id: z.string().uuid(), name: z.string(), createdAt: z.string(), expiresAt: z.string().nullable(), revokedAt: z.string().nullable() });
export const personalTokensSchema = z.array(personalTokenSchema);
export const issuedTokenSchema = z.object({ id: z.string().uuid(), token: z.string().regex(/^ntfs_[a-f0-9]{64}$/) });
export const permanentTokenWarning = '此Token不会自动过期，拥有它的人可在你的当前权限范围内调用系统。泄露后可能被持续使用，请妥善保管，不再使用或疑似泄露时立即撤销。';
