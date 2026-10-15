import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { smoke } from '../../api/dist/organization/integration-smoke.js';
import { organizationSnapshotSchema } from '@ntfs/contracts';

// 编译真实网页API入口，在独立随机夹具上验证同源操作，结束后由夹具清理数据和服务。
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = await build({ stdin: { contents: "export * from './apps/web/src/weekly-plans/api.ts'; export * from './apps/web/src/work/api.ts'; export * from './apps/web/src/work/assignments-api.ts';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

await smoke(async ({ base, call, leader, projectId }) => {
  const organization = organizationSnapshotSchema.parse(await (await call('organization', leader)).json());
  const team = organization.teams[0]; assert.ok(team);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (path, options) => typeof path === 'string' && path.startsWith('/api/')
    ? nativeFetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Origin: base, Cookie: leader.cookie } })
    : nativeFetch(path, options);
  try {
    const task = await api.workCommand({ action: 'create_task', projectId, title: '周计划入口连续维护验收', description: '', acceptance: '', operationId: randomUUID() }, leader.csrf);
    await api.assignmentCommand({ action: 'assign_many', taskId: task.objectId, members: [{ accountId: team.leaderId, groupId: null, content: '持续推进' }], operationId: randomUUID() }, leader.csrf);
    const week = '2031-01-06'; const next = '2031-01-13'; const later = '2031-01-20';
    const state = await api.weeklySnapshot(team.id, week);
    const candidate = state.candidates.find((entry) => entry.taskId === task.objectId); assert.ok(candidate);
    const fields = { assignmentId: candidate.assignmentId, assignmentVersion: candidate.assignmentVersion, taskVersion: candidate.taskVersion, version: null, goal: '本周接口', plannedDays: '1.50', expectedProgress: 20 };
    await api.saveWeeklyBatch({ action: 'save_arrangements', teamId: team.id, week, arrangements: [fields] }, leader.csrf, true);
    const first = (await api.weeklySnapshot(team.id, week)).draft?.arrangements.find((entry) => entry.assignmentId === candidate.assignmentId);
    const second = (await api.weeklySnapshot(team.id, next)).draft?.arrangements.find((entry) => entry.assignmentId === candidate.assignmentId);
    assert.ok(first && second); assert.equal(first.goal, '本周接口'); assert.equal(second.goal, ''); assert.equal(second.plannedDays, null);
    await api.weeklyCommand({ action: 'save_arrangement', teamId: team.id, week: next, ...fields, version: second.version, goal: '下周单独目标', plannedDays: '2.00' }, leader.csrf);
    await api.saveWeeklyBatch({ action: 'save_arrangements', teamId: team.id, week, arrangements: [{ ...fields, version: first.version, goal: '本周调整' }] }, leader.csrf, true);
    const preserved = (await api.weeklySnapshot(team.id, next)).draft?.arrangements.find((entry) => entry.assignmentId === candidate.assignmentId);
    assert.ok(preserved); assert.equal(preserved.goal, '下周单独目标'); assert.equal(preserved.plannedDays, '2.00');
    await api.moveWeeklyArrangement(team.id, next, later, preserved, leader.csrf);
    assert.equal((await api.weeklySnapshot(team.id, next)).draft?.arrangements.length, 0);
    assert.equal((await api.weeklySnapshot(team.id, later)).draft?.arrangements[0]?.goal, '下周单独目标');
    assert.equal((await api.weeklySnapshot(team.id, week)).draft?.arrangements[0]?.goal, '本周调整');
    const work = await api.workSnapshot(projectId); assert.equal(work.tasks.filter((entry) => entry.id === task.objectId).length, 1);
    console.log('PASS: actual web API create -> assign -> two-week scheduling, independent targets, existing target preservation and move without task copies');
  } finally { globalThis.fetch = nativeFetch; }
});
