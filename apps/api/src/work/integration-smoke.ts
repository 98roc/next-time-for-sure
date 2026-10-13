import { verifyMilestones } from './milestone.integration.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workSnapshotSchema } from '@ntfs/contracts';
import type { WorkCommand } from '@ntfs/contracts';
import { smoke } from '../organization/integration-smoke.js';
import type { WorkFixture, Session } from '../organization/integration-smoke.js';
import { verifyAssignments } from './assignment.integration.js';
import { verifyPersonal } from './personal.integration.js';

/** 复用隔离组织夹具，验证需求处理、版本竞争及任务幂等的真实HTTP链路。 */
async function verify(fixture: WorkFixture): Promise<void> {
  const { call, developer, leader, projectId, otherProjectId, ownerId } = fixture;
  async function execute(command: WorkCommand, auth: Session = developer, expected = 200): Promise<string> {
    const response = await call('work/commands', auth, command); assert.equal(response.status, expected, command.action);
    if (expected !== 200) return '';
    return z.object({ objectId: z.string().uuid() }).parse(await response.json()).objectId;
  }
  async function snapshot() { const response = await call(`work?projectId=${projectId}`, developer); assert.equal(response.status, 200); return workSnapshotSchema.parse(await response.json()); }
  assert.equal((await call(`work?projectId=${otherProjectId}`, developer)).status, 403);
  const submission: WorkCommand = { action: 'submit_request', projectId, title: 'API验收需求', description: '', acceptance: '', operationId: randomUUID() };
  const requestId = await execute(submission);
  assert.equal(await execute(submission), requestId);
  await execute({ ...submission, title: '同键不同内容' }, developer, 409);
  await execute({ action: 'review_request', requestId, decision: 'supplement_required', reason: '请补充背景', version: 0 });
  assert.equal((await snapshot()).tasks.length, 0);
  await execute({ action: 'accept_request', requestId, ownerId, version: 1, operationId: randomUUID() }, developer, 409);
  await execute({ action: 'supplement_request', requestId, content: '补充背景', version: 1 });
  await execute({ action: 'edit_request', requestId, title: '更新需求', description: '接收前最新说明', acceptance: '', version: 2 });
  const accept: WorkCommand = { action: 'accept_request', requestId, ownerId, version: 3, operationId: randomUUID() };
  const competing = await Promise.all([call('work/commands', developer, accept), call('work/commands', developer, { action: 'withdraw_request', requestId, version: 3 })]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  let current = (await snapshot()).requests.find((entry) => entry.id === requestId); assert.ok(current);
  let taskId: string;
  if (current.status === 'withdrawn') {
    await execute({ action: 'resubmit_request', requestId, version: current.version });
    current = (await snapshot()).requests.find((entry) => entry.id === requestId); assert.ok(current);
    const retry = { ...accept, version: current.version };
    taskId = await execute(retry); assert.equal(await execute(retry), taskId);
  } else { taskId = await execute(accept); }
  current = (await snapshot()).requests.find((entry) => entry.id === requestId); assert.ok(current);
  await execute({ action: 'edit_request', requestId, title: '不允许覆盖', description: '', acceptance: '', version: current.version }, developer, 409);
  await execute({ action: 'supplement_request', requestId, content: '接收后追加说明', version: current.version });
  const state = await snapshot();
  assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0]?.id, taskId);
  assert.equal(state.tasks[0]?.description, '接收前最新说明'); assert.equal(state.tasks[0]?.ownerId, ownerId); assert.equal(state.tasks[0]?.status, 'not_started');
  assert.ok(state.events.some((entry) => entry.action === 'supplement_request' && entry.payload.content === '接收后追加说明'));
  const pending = await execute({ ...submission, operationId: randomUUID() });
  await execute({ action: 'review_request', requestId: pending, decision: 'deferred', reason: '等待条件', version: 0 }, leader);
  await execute({ action: 'review_request', requestId: pending, decision: 'pending', reason: '条件齐备', version: 1 }, leader);
  await execute({ action: 'review_request', requestId: pending, decision: 'rejected', reason: '范围需调整', version: 2 }, leader);
  await execute({ action: 'edit_request', requestId: pending, title: '调整范围', description: '', acceptance: '', version: 3 });
  assert.equal((await snapshot()).requests.find((entry) => entry.id === pending)?.status, 'rejected');
  await execute({ action: 'resubmit_request', requestId: pending, version: 4 });
  const direct: WorkCommand = { action: 'create_task', projectId, title: '研发直接建任务', description: '', acceptance: '', operationId: randomUUID() };
  const directId = await execute(direct); assert.equal(await execute(direct), directId);
  assert.equal((await snapshot()).tasks.length, 2);
  await verifyAssignments(fixture, taskId, directId);
  await verifyPersonal(fixture, taskId);
  await verifyMilestones(fixture, taskId);
  console.log('PASS: intake, latest-content acceptance, supplements, defer/resume/reject/resubmit, accept-versus-withdraw race, replay idempotency and direct task creation');
}

await smoke(verify);
