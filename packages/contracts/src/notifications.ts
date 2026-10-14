import { z } from 'zod';
/** 通知只携带最小业务提示，点击目标仍重新校验权限。 */
export const notificationPayloadSchema = z.object({ recipients: z.array(z.string().uuid()), title: z.string(), objectId: z.string(), path: z.string() });
export const notificationSchema = z.object({ id: z.string().uuid(), eventId: z.string().uuid(), title: z.string(), path: z.string(), createdAt: z.string(), readAt: z.string().nullable() });
export const notificationsSchema = z.array(notificationSchema);
export const readNotificationSchema = z.object({ id: z.string().uuid() }).strict();
