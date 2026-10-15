import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { personalSnapshotSchema, assignmentSnapshotSchema, assignmentCompletionSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { PersonalCommand } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 私人隔离、个人执行及分工确认的真实数据库回归。 */
export async function verifyPersonal(fixture: WorkFixture, taskId: string): Promise<void> {
  const { call, developer, leader, admin, manager, projectId, ownerId } = fixture;
  async function execute(command: PersonalCommand, auth: Session = developer, expected = 200) {
    const response = await call('personal/commands', auth, command); assert.equal(response.status, expected, command.action);
    return expected === 200 ? z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId : '';
  }
  async function state(auth = developer, scope = 'mine') { const response = await call(`personal?scope=${scope}`, auth); assert.equal(response.status, 200); return personalSnapshotSchema.parse(await response.json()); }
  const privateInput: PersonalCommand = { action: 'create_personal', kind: 'private', projectId: null, assignmentId: null, title: '仅本人可见的验收事项', description: '私人说明验收标记', acceptance: '', categoryId: null, operationId: randomUUID() };
  const privateId = await execute(privateInput); assert.equal(await execute(privateInput), privateId);
  await execute({ ...privateInput, operationId: randomUUID(), projectId }, developer, 400);
  await execute({ ...privateInput, operationId: randomUUID(), kind: 'work' }, developer, 400);
  const workId = await execute({ ...privateInput, kind: 'work', projectId, title: '独立研发工作', description: '', operationId: randomUUID() });
  assert.ok((await state(leader, 'visible')).items.some((item) => item.id === workId));
  for (const auth of [leader, admin, manager]) {
    const visible = await state(auth, 'visible');
    assert.equal(visible.items.some((item) => item.id === privateId), false);
    assert.equal((await call(`personal/history?itemId=${privateId}`, auth)).status, 403);
    await execute({ action: 'start_personal', itemId: privateId, version: 0 }, auth, 403);
  }
  assert.equal((await state(manager, 'visible')).items.some((item) => item.id === workId), false);
  assert.equal((await state(admin, 'visible')).items.some((item) => item.id === workId), false);
  await execute({ action: 'start_personal', itemId: workId, version: 0 }, leader, 403);
  const categoryId = await execute({ action: 'create_category', name: '个人安排', operationId: randomUUID() });
  await execute({ action: 'move_personal', itemId: workId, categoryId, position: 10, version: 0 });
  assert.equal((await state()).items.find((item) => item.id === workId)?.status, 'not_started');
  const checklistId = randomUUID();
  await execute({ action: 'edit_personal', itemId: workId, title: '独立研发工作', description: '', acceptance: '', checklist: [{ id: checklistId, title: '核对接口', checked: true }], plannedOn: '2026-10-14', blockedReason: '', version: 1 });
  assert.equal((await state()).items.find((item) => item.id === workId)?.status, 'not_started');
  const progress: PersonalCommand = { action: 'personal_progress', itemId: workId, occurredOn: '2026-10-13', reportWeek: '2026-10-12', content: '本次进展', version: 2, operationId: randomUUID() };
  const progressId = await execute(progress); assert.equal(await execute(progress), progressId);
  await execute({ ...progress, content: '第二条进展', version: 3, operationId: randomUUID() });
  assert.equal((await state()).progress.filter((entry) => entry.itemId === workId).length, 2);
  await execute({ action: 'start_personal', itemId: workId, version: 4 });
  await execute({ action: 'complete_personal', itemId: workId, version: 5 });
  const completed = (await state()).items.find((item) => item.id === workId); assert.ok(completed?.endedAt);
  await execute({ action: 'start_personal', itemId: workId, version: 6 });
  assert.equal((await state()).items.find((item) => item.id === workId)?.endedAt, null);
  assert.equal((await state()).items.find((item) => item.id === workId)?.startedAt, completed.startedAt);
  const ownHistory = await call(`personal/history?itemId=${workId}`, developer); assert.equal(ownHistory.status, 200);
  assert.match(JSON.stringify(await ownHistory.json()), /complete_personal/);

  // 重新认领已退出任务，将工作关联到本人有效责任上。
  const all = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json());
  const old = all.assignments.find((entry) => entry.taskId === taskId && entry.accountId === ownerId); assert.ok(old);
  const claimed = await call('assignments/commands', developer, { action: 'claim', taskId, groupId: old.groupId, content: '', operationId: randomUUID() }); assert.equal(claimed.status, 200);
  const assignmentId = z.object({ objectId: z.string() }).parse(await claimed.json()).objectId;
  await execute({ action: 'link_personal', itemId: workId, assignmentId, version: 7 });
  const preview = assignmentCompletionSchema.parse(await (await call(`assignments/completion?assignmentId=${assignmentId}`, developer)).json());
  assert.equal(preview.unfinished.length, 1);
  assert.equal((await call('assignments/commands', developer, { action: 'complete', assignmentId, version: preview.assignmentVersion })).status, 409);
  await execute({ action: 'edit_personal', itemId: workId, title: '确认期间内容改变', description: '', acceptance: '', checklist: [], plannedOn: null, blockedReason: '', version: 8 });
  assert.equal((await call('assignments/commands', developer, { action: 'complete', assignmentId, version: preview.assignmentVersion, confirmation: preview.confirmation })).status, 409);
  const refreshed = assignmentCompletionSchema.parse(await (await call(`assignments/completion?assignmentId=${assignmentId}`, developer)).json());
  assert.equal((await call('assignments/commands', developer, { action: 'complete', assignmentId, version: refreshed.assignmentVersion, confirmation: refreshed.confirmation })).status, 200);
  const stopped = (await state()).items.find((item) => item.id === workId); assert.equal(stopped?.status, 'in_progress'); assert.ok(stopped.stopReason);
  await execute({ action: 'edit_personal', itemId: workId, title: '尝试新增执行工作', description: '', acceptance: '', checklist: [{ id: randomUUID(), title: '新项', checked: false }], plannedOn: null, blockedReason: '', version: 9 }, developer, 409);
  await execute({ action: 'start_personal', itemId: workId, version: 9 });
  const restored = assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, developer)).json()).assignments.find((entry) => entry.id === assignmentId);
  assert.equal(restored?.status, 'in_progress'); assert.ok(restored?.startedAt); assert.equal(restored?.endedAt, null);
  await execute({ action: 'delete_category', categoryId, version: 0 });
  assert.equal((await state()).items.find((item) => item.id === workId)?.categoryId, (await state()).categories.find((entry) => entry.status === 'in_progress')?.id);
  const team = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, leader)).json());
  assert.equal(JSON.stringify(team).includes('私人说明验收标记'), false);
  console.log('PASS: private/history isolation, PM-only restriction, owner-only edits, independent categories/checklist, multiple progress entries, exact time history and version-bound assignment completion/reopening');
}
