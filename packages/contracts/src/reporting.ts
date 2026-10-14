import { z } from 'zod';
import { reportWeekSchema } from './assignments.js';
const id = z.string().uuid();
const version = z.number().int().nonnegative();
export const reportingQuerySchema = z.object({ teamId: id, week: reportWeekSchema }).strict();
/** 发布时保存可独立展示的文字及标识，不依赖源对象一直存在。 */
export const publicationRowSchema = z.object({ projectId: id, projectName: z.string(), taskId: id.nullable(), title: z.string(), accountId: id.nullable(), person: z.string(), groupId: id.nullable(), text: z.string(), plannedDays: z.string().nullable(), status: z.string(), sourceIds: z.array(z.string()) });
export const publicationSchema = z.object({ id, kind: z.enum(['plan', 'report']), confirmation: z.string(), revision: z.number().int(), createdAt: z.string(), reason: z.string(), rows: z.array(publicationRowSchema), next: z.array(publicationRowSchema) });
export const reportSourceSchema = publicationRowSchema.extend({ key: z.string(), hash: z.string(), occurredOn: z.string().nullable(), sourceKind: z.enum(['assignment', 'personal', 'plan']), sourceId: z.string(), ownerId: id.nullable() });
export const reportEntrySchema = z.object({ id, projectId: id, projectName: z.string(), taskId: id.nullable(), title: z.string(), text: z.string(), excluded: z.boolean(), edited: z.boolean(), sources: z.array(reportSourceSchema) });
export const reportDraftSchema = z.object({ id, version, entries: z.array(reportEntrySchema), changedKeys: z.array(z.string()), newCount: z.number().int() }).nullable();
export const reportStateSchema = z.object({ draft: reportDraftSchema, sources: z.array(reportSourceSchema), publications: z.array(publicationSchema), canPublish: z.boolean(), canEdit: z.boolean() });
export const reportCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), teamId: id, week: reportWeekSchema }).strict(),
  z.object({ action: z.literal('edit'), teamId: id, week: reportWeekSchema, version, entryId: id, text: z.string().trim().min(1).max(20000), excluded: z.boolean(), acceptChanges: z.boolean() }).strict(),
  z.object({ action: z.literal('merge'), teamId: id, week: reportWeekSchema, version, entryIds: z.array(id).min(2).max(100), text: z.string().trim().min(1).max(20000) }).strict(),
  z.object({ action: z.literal('publish'), teamId: id, week: reportWeekSchema, version, reason: z.string().trim().min(1).max(2000), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('reassign_week'), teamId: id, week: reportWeekSchema, sourceKind: z.enum(['assignment', 'personal']), sourceId: id, sourceHash: z.string(), targetWeek: reportWeekSchema }).strict(),
]);
export type ReportCommand = z.infer<typeof reportCommandSchema>;
export type ReportSource = z.infer<typeof reportSourceSchema>;
export type ReportEntry = z.infer<typeof reportEntrySchema>;
export type PublicationRow = z.infer<typeof publicationRowSchema>;
export const tagSchema = z.object({ id, objectId: id, objectKind: z.enum(['task', 'personal']), dimension: z.enum(['milestone', 'weekly']), week: z.string(), marked: z.boolean(), version });
export const tagCommandSchema = z.object({ objectId: id, objectKind: z.enum(['task', 'personal']), dimension: z.enum(['milestone', 'weekly']), week: reportWeekSchema.nullable(), marked: z.boolean(), version: version.nullable() }).strict();
export type TagCommand = z.infer<typeof tagCommandSchema>;
export const tagsSchema = z.array(tagSchema);
export const confirmationSchema = z.object({ confirmation: z.string() });
export const publicationPreviewSchema = confirmationSchema.extend({ rows: z.array(publicationRowSchema), next: z.array(publicationRowSchema).optional() });
export const planPublicationsSchema = z.object({ publications: z.array(publicationSchema), canEdit: z.boolean(), canPublish: z.boolean(), pendingCandidates: z.array(z.object({ id, version, title: z.string() })) });
export const tagStateSchema = z.object({ tags: tagsSchema, milestone: z.boolean(), weekly: z.boolean(), inherited: z.boolean() });
export type Publication = z.infer<typeof publicationSchema>;
