import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignmentSnapshotSchema, issuedTokenSchema, notificationsSchema, organizationSnapshotSchema, personalSnapshotSchema, planPublicationsSchema, publicationPreviewSchema, reportStateSchema, weeklyCandidatesSchema, weeklyDraftSchema, workSnapshotSchema } from '@ntfs/contracts';
import type { Session, WorkFixture } from '../organization/integration-smoke.js';

/** 直属分工贯通真实 API：候选、权限、周安排、发布历史、周报、转交与拆分。 */
export async function verifyTeamDirect({ call, leader, developer, manager, admin, projectId, ownerId }: WorkFixture): Promise<void> {
  const org = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const team = org.teams[0]; const group = org.groups.find((entry) => entry.leaderId === ownerId);
  const ungrouped = org.accounts.find((entry) => entry.teamId === team?.id && !org.groups.some((item) => item.memberIds.includes(entry.id)));
  assert.ok(team && group && ungrouped);
  const week = '2027-02-01'; const nextWeek = '2027-02-08'; const base = { teamId: team.id, week };
  async function write(path: string, body: unknown, auth: Session = leader) {
    const response = await call(path, auth, body);
    assert.equal(response.status, 200, `${path}: ${response.status} ${response.status === 200 ? '' : await response.text()}`);
    return z.object({ objectId: z.string() }).parse(await response.json()).objectId;
  }
  const create = (title: string) => write('work/commands', { action: 'create_task', projectId, title, description: '', acceptance: '', operationId: randomUUID() }, developer);
  const assignments = async () => assignmentSnapshotSchema.parse(await (await call(`assignments?projectId=${projectId}`, leader)).json());
  async function assignment(id: string) { const entry = (await assignments()).assignments.find((item) => item.id === id); assert.ok(entry); return entry; }
  const candidates = async (auth = leader) => weeklyCandidatesSchema.parse(await (await call(`weekly-plans/candidates?teamId=${team.id}&week=${week}`, auth)).json()).assignments;
  const draft = async (targetWeek = week, auth = leader) => z.object({ draft: weeklyDraftSchema }).parse(await (await call(`weekly-plans?teamId=${team.id}&week=${targetWeek}`, auth)).json()).draft;
  const report = async (auth = leader) => reportStateSchema.parse(await (await call(`reports?teamId=${team.id}&week=${week}`, auth)).json());

  // 未入组成员可被分配；小组长、仅项目经理和超管不能分配直属工作。
  const taskId = await create('团队直属验收');
  const assign = { action: 'assign', taskId, accountId: ungrouped.id, groupId: null, content: '直属执行', operationId: randomUUID() };
  for (const auth of [developer, manager, admin]) assert.equal((await call('assignments/commands', auth, assign)).status, 403);
  const issued = issuedTokenSchema.parse(await (await call('tokens', leader, { name: '直属回归', expiresAt: null, permanentConfirmed: true })).json());
  const agentLeader: Session = { cookie: '', csrf: '', bearer: issued.token };
  const first = await write('assignments/commands', assign, agentLeader);
  assert.equal(await write('assignments/commands', assign), first);
  assert.equal((await assignment(first)).groupId, null);

  // 无所属小组的独立工作也可由团队负责人关联直属分工，个人内容不被代改。
  const ungroupedItem = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId: null, title: '无小组工作关联', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, manager);
  await write('personal/commands', { action: 'manage_link', itemId: ungroupedItem, assignmentId: first, version: 0 });
  const linked = personalSnapshotSchema.parse(await (await call('personal?scope=mine', manager)).json()).items.find((entry) => entry.id === ungroupedItem);
  assert.equal(linked?.assignmentId, first);
  assert.equal(linked?.title, '无小组工作关联');
  await write('personal/commands', { action: 'manage_link', itemId: ungroupedItem, assignmentId: null, version: 1 });
  const batchTask = await create('直属批次原子性');
  const batch = { action: 'assign_many', taskId: batchTask, operationId: randomUUID(), members: [{ accountId: ungrouped.id, groupId: null, content: '' }, { accountId: randomUUID(), groupId: null, content: '' }] };
  assert.equal((await call('assignments/commands', leader, batch)).status, 400);
  assert.equal((await assignments()).assignments.some((entry) => entry.taskId === batchTask), false);
  await write('assignments/commands', { ...batch, members: [batch.members[0], { accountId: ownerId, groupId: group.id, content: '小组工作' }] });
  assert.equal((await assignments()).assignments.filter((entry) => entry.taskId === batchTask).length, 2);

  // 小组成员也能采用直属归属，其组长不能沿所属组回退获取管理权。
  const directMember = await write('assignments/commands', { ...assign, accountId: ownerId, operationId: randomUUID() });
  assert.ok((await candidates()).some((entry) => entry.assignmentId === directMember && entry.groupName === '团队直属'));
  assert.equal((await candidates(developer)).some((entry) => [directMember, first].includes(entry.assignmentId)), false);
  const candidate = (await candidates()).find((entry) => entry.assignmentId === directMember); assert.ok(candidate);
  const schedule = { action: 'save_arrangement', ...base, assignmentId: directMember, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: null, goal: '直属本周目标', expectedProgress: 25, plannedDays: '1.50' };
  assert.equal((await call('weekly-plans/commands', developer, schedule)).status, 409);
  await write('weekly-plans/commands', schedule);
  assert.equal((await draft(week, developer))?.arrangements.some((entry) => entry.assignmentId === directMember), false);
  const preview = publicationPreviewSchema.parse(await (await call(`weekly-plans/preview?teamId=${team.id}&week=${week}`, leader)).json());
  assert.equal(preview.rows.find((entry) => entry.sourceIds.includes(directMember))?.plannedDays, '1.50');
  await write('weekly-plans/commands', { action: 'publish_plan', ...base, confirmation: preview.confirmation, reason: '直属回归验收' });
  const publications = async () => planPublicationsSchema.parse(await (await call(`weekly-plans/publications?teamId=${team.id}&week=${week}`, manager)).json()).publications;
  const frozen = JSON.stringify(await publications());
  await write('weekly-plans/commands', { action: 'carry_forward', teamId: team.id, week: nextWeek });
  assert.ok((await draft(nextWeek))?.arrangements.some((entry) => entry.assignmentId === directMember));
  const arrangement = (await draft())?.arrangements.find((entry) => entry.assignmentId === directMember); assert.ok(arrangement);
  assert.equal((await call('weekly-plans/commands', developer, { action: 'remove_arrangement', ...base, arrangementId: arrangement.id, version: arrangement.version })).status, 403);

  // 执行事实仍仅本人维护，分工及关联个人进展均进入团队周报。
  assert.equal((await call('assignments/commands', leader, { action: 'start', assignmentId: directMember, version: 0 })).status, 403);
  await write('assignments/commands', { action: 'start', assignmentId: directMember, version: 0 }, developer);
  await write('assignments/commands', { action: 'record_progress', assignmentId: directMember, version: 1, occurredOn: week, reportWeek: week, content: '直属进展', operationId: randomUUID() }, developer);
  const itemId = await write('personal/commands', { action: 'create_personal', kind: 'work', projectId, assignmentId: directMember, title: '直属关联事项', description: '', acceptance: '', categoryId: null, operationId: randomUUID() }, developer);
  await write('personal/commands', { action: 'personal_progress', itemId, version: 0, occurredOn: week, reportWeek: week, content: '直属个人进展', operationId: randomUUID() }, developer);
  await write('reports/commands', { action: 'generate', ...base });
  const reportState = await report(); assert.ok(reportState.draft);
  assert.ok(reportState.draft.entries.some((entry) => entry.text.includes('直属个人进展')));
  const reportEntry = reportState.draft.entries.find((entry) => entry.text.includes('直属进展')); assert.ok(reportEntry);
  assert.equal((await report(developer)).draft?.entries.some((entry) => entry.id === reportEntry.id), false);
  assert.equal((await call('reports/commands', developer, { action: 'edit', ...base, version: reportState.draft.version, entryId: reportEntry.id, text: '越权', excluded: false, acceptChanges: false })).status, 403);
  assert.equal((await call('personal/commands', developer, { action: 'manage_link', itemId, assignmentId: null, version: 1 })).status, 403);
  const reportPreview = publicationPreviewSchema.parse(await (await call(`reports/preview?teamId=${team.id}&week=${week}`, leader)).json());
  await write('reports/commands', { action: 'publish', ...base, version: reportState.draft.version, confirmation: reportPreview.confirmation, reason: '直属周报验收' });
  assert.ok((await report(manager)).publications[0]?.rows.some((entry) => entry.text.includes('直属进展')));

  // 责任在直属和小组之间调整后重验权限，旧发布副本保持原样。
  const adjust = { action: 'adjust', assignmentId: directMember, version: (await assignment(directMember)).version, groupId: group.id, content: '交回小组' };
  assert.equal((await call('assignments/commands', developer, adjust)).status, 403);
  await write('assignments/commands', adjust);
  assert.ok((await candidates(developer)).some((entry) => entry.assignmentId === directMember));
  await write('assignments/commands', { ...adjust, version: (await assignment(directMember)).version, groupId: null });
  assert.equal((await candidates(developer)).some((entry) => entry.assignmentId === directMember), false);
  assert.equal(JSON.stringify(await publications()), frozen);
  const transfer = { action: 'transfer', assignmentId: first, version: 0, accountId: team.leaderId, groupId: null, content: '直属接手', reason: '验收转交', operationId: randomUUID() };
  assert.equal((await call('assignments/commands', developer, transfer)).status, 403);
  const replacement = await write('assignments/commands', transfer);
  assert.equal((await assignment(first)).status, 'transferred'); assert.equal((await assignment(replacement)).groupId, null);

  // 管理者撤销责任保留发布副本、进展和个人状态；权限、旧版本及重复移除均不能绕过。
  const beforeRemoval = await assignment(directMember);
  const beforeProgress = (await assignments()).progress.filter((entry) => entry.assignmentId === directMember);
  const beforePersonal = personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()).items.find((entry) => entry.id === itemId);
  const remove = { action: 'remove', assignmentId: directMember, version: beforeRemoval.version };
  for (const auth of [developer, manager, admin]) assert.equal((await call('assignments/commands', auth, remove)).status, 403);
  assert.equal((await call('assignments/commands', leader, { ...remove, version: remove.version - 1 })).status, 409);
  await write('assignments/commands', remove, agentLeader);
  assert.equal((await assignment(directMember)).status, 'exited');
  assert.equal((await candidates()).some((entry) => entry.assignmentId === directMember), false);
  assert.deepEqual((await assignments()).progress.filter((entry) => entry.assignmentId === directMember), beforeProgress);
  assert.equal(personalSnapshotSchema.parse(await (await call('personal?scope=mine', developer)).json()).items.find((entry) => entry.id === itemId)?.status, beforePersonal?.status);
  assert.equal(JSON.stringify(await publications()), frozen);
  assert.ok((await draft())?.arrangements.some((entry) => entry.assignmentId === directMember));
  assert.equal((await call('assignments/commands', leader, remove)).status, 409);
  const readded = await write('assignments/commands', { ...assign, accountId: ownerId, operationId: randomUUID() });
  assert.notEqual(readded, directMember);
  await write('assignments/commands', { action: 'complete', assignmentId: readded, version: 0 }, developer);
  assert.equal((await call('assignments/commands', leader, { action: 'remove', assignmentId: readded, version: 1 })).status, 409);

  // 未入组本人可认领直属工作；认领及退出通知团队负责人。
  const claimTask = await create('无小组认领');
  const claimed = await write('assignments/commands', { action: 'claim', taskId: claimTask, groupId: null, content: '', operationId: randomUUID() }, manager);
  assert.equal((await assignment(claimed)).accountId, ungrouped.id);
  await write('assignments/commands', { action: 'exit', assignmentId: claimed, version: 0, reason: '验收退出' }, manager);
  const notices = notificationsSchema.parse(await (await call('notifications', leader)).json());
  assert.ok(notices.some((entry) => entry.title.includes('团队直属')));

  const parent = await create('直属拆分');
  const toMove = await write('assignments/commands', { ...assign, taskId: parent, operationId: randomUUID() });
  const childKey = randomUUID();
  const split = { taskId: parent, version: 0, operationId: randomUUID(), children: [{ key: childKey, title: '直属子任务', description: '', acceptance: '' }], moves: [{ assignmentId: toMove, version: 0, childKey }] };
  assert.equal((await call('tasks/split', developer, split)).status, 403);
  await write('tasks/split', split);
  const work = workSnapshotSchema.parse(await (await call(`work?projectId=${projectId}`, leader)).json());
  assert.equal((await assignment(toMove)).taskId, work.tasks.find((entry) => entry.parentId === parent)?.id);
  assert.equal((await assignment(toMove)).groupId, null);
  console.log('PASS: team-direct assign/claim, atomic batch, group permission isolation, weekly carry/publish, reports, immutable history, transfer, split and notifications');
}
