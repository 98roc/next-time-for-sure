import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { v2WorkspaceSchema, v2WeeklyStateSchema, v2TaskEventSchema } from '@ntfs/contracts';
import { AppModule } from '../../app.module.js';
import { SafeExceptionFilter } from '../../safe-exception.filter.js';
import { digest } from '../../identity/password.js';
import { readSource, type LegacySource } from './source.js';
import { targetId } from './plan.js';

/** 仅由隔离演练调用；用临时会话核验转换后真实 API 与源数据，不使用原会话或密码。 */
export async function verifyConverted(source: DataSource, legacyInput?: LegacySource): Promise<void> {
  const legacy = legacyInput ?? await readSource(source.manager);
  const options = z.object({ host: z.literal('127.0.0.1'), port: z.number(), username: z.string(), password: z.string() }).parse(source.options);
  const previous = Object.fromEntries(['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DB_HOST: options.host, DB_PORT: String(options.port), DB_USERNAME: options.username, DB_PASSWORD: options.password, DB_DATABASE: 'next_time_for_sure' });
  const app = await NestFactory.create(AppModule, { logger: false });
  const sessionHashes: string[] = [];
  try {
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    for (const team of legacy.teams) {
      const token = randomBytes(32).toString('hex'), hash = digest(token); sessionHashes.push(hash);
      await source.query('INSERT INTO login_sessions(token_hash,account_id,csrf_token,created_at,expires_at) VALUES (?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))', [hash, team.leader_id, randomBytes(32).toString('hex')]);
      const get = async (path: string) => { const response = await fetch(`${base}/api/v1/${path}`, { headers: { Cookie: `ntfs_session=${token}`, 'X-NTFS-Session-Activity': 'passive' }, signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200, path); return response.json(); };
      const workspace = v2WorkspaceSchema.parse(await get('v2/workspace'));
      await get('health/ready');
      const projectIds = legacy.projects.filter((row) => row.team_id === team.id).map((row) => row.id);
      const active = legacy.assignments.filter((row) => projectIds.includes(legacy.tasks.find((task) => task.id === row.task_id)?.project_id ?? '') && !['exited', 'transferred'].includes(row.status));
      const independent = legacy.personal.filter((row) => !row.assignment_id && row.kind === 'work' && projectIds.includes(row.project_id ?? ''));
      assert.equal(workspace.tasks.filter((row) => row.kind === 'project').length, active.length + independent.length);
      for (const assignment of active) {
        const item = legacy.personal.find((row) => row.assignment_id === assignment.id), original = legacy.tasks.find((row) => row.id === assignment.task_id);
        const actual = workspace.tasks.find((row) => row.id === targetId('task', assignment.id)); assert.ok(actual);
        assert.equal(actual.executorId, assignment.account_id); assert.equal(actual.status, item?.status ?? assignment.status); assert.equal(actual.title, item?.title ?? original?.title);
        assert.ok(workspace.arrangements.some((row) => row.taskId === actual.id));
        const events = z.array(v2TaskEventSchema).parse(await get(`v2/history?taskId=${actual.id}`));
        assert.equal(events.at(-1)?.snapshot.status, actual.status); assert.equal(events.at(-1)?.sequence, actual.version);
      }
      for (const item of independent) {
        const actual = workspace.tasks.find((row) => row.id === targetId('task', item.id)); assert.ok(actual);
        assert.equal(actual.title, item.title); assert.equal(actual.status, item.status); assert.equal(actual.executorId, item.owner_id);
      }
      const summary = workspace.periods.find((row) => row.startOn === '2026-10-12'), plan = workspace.periods.find((row) => row.startOn === '2026-10-19');
      if (summary && plan) {
        const weekly = v2WeeklyStateSchema.parse(await get(`v2/weekly?summaryPeriodId=${summary.id}&planPeriodId=${plan.id}`));
        assert.equal(weekly.canEditText, true);
        const supplements = z.array(z.object({ task_id: z.string() })).parse(await source.query("SELECT task_id FROM v2_arrangement_history WHERE period_id=? AND provenance='migration_supplement'", [summary.id]));
        for (const row of supplements) { const item = weekly.summary.find((entry) => entry.taskId === row.task_id); assert.ok(item); assert.equal(item.planning, 'unplanned'); }
      }
    }
  } finally {
    await app.close();
    for (const hash of sessionHashes) await source.query('DELETE FROM login_sessions WHERE token_hash=?', [hash]);
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
