import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { SafeExceptionFilter } from '../safe-exception.filter.js';
import { loadEnvironment } from '../config/environment.js';
import { createDataSource } from '../database/data-source.js';
import { digest } from '../identity/password.js';

export type Session = { id: string; cookie: string; csrf: string; bearer?: string };
export type Fixture = { source: DataSource; base: string; prefix: string; teamId: string; projectId: string; otherProjectId: string; admin: Session; leader: Session; developer: Session; outsider: Session; call: (path: string, actor?: Session, body?: unknown) => Promise<Response> };

/** 本机 HTTP/MySQL 隔离夹具；只清理随机前缀所属对象，不使用真实账号。 */
export async function withFixture(verify: (fixture: Fixture) => Promise<void>): Promise<void> {
  const environment = loadEnvironment();
  if (environment.DB_HOST !== '127.0.0.1') throw new Error('Local database required');
  const source = createDataSource(environment); await source.initialize();
  const prefix = `v2check.${randomBytes(6).toString('hex')}`, teamId = randomUUID(), projectId = randomUUID(), otherProjectId = randomUUID();
  let app: INestApplication | undefined;
  try {
    const actor = async (name: string, admin = false): Promise<Session> => {
      const id = randomUUID(), token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      await source.query('INSERT INTO accounts(id,login_name,display_name,password_hash,is_super_admin,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))', [id, `${prefix}.${name}`, name, 'unusable-test-fixture', admin ? 1 : 0]);
      await source.query('INSERT INTO login_sessions(token_hash,account_id,csrf_token,created_at,expires_at) VALUES (?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))', [digest(token), id, csrf]);
      return { id, cookie: `ntfs_session=${token}`, csrf };
    };
    const admin = await actor('admin', true), leader = await actor('leader'), developer = await actor('developer'), outsider = await actor('outsider');
    await source.query('INSERT INTO teams(id,name,leader_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [teamId, `${prefix}.team`, leader.id]);
    for (const member of [leader, developer, outsider]) await source.query('UPDATE accounts SET team_id=? WHERE id=?', [teamId, member.id]);
    for (const id of [projectId, otherProjectId]) await source.query('INSERT INTO projects(id,team_id,name) VALUES (?,?,?)', [id, teamId, id === projectId ? '测试可见项目' : '测试隔离项目']);
    await source.query('INSERT INTO project_members(project_id,account_id,roles_json) VALUES (?,?,?),(?,?,?),(?,?,?)', [projectId, leader.id, JSON.stringify(['project_manager', 'project_lead']), projectId, developer.id, JSON.stringify(['developer']), otherProjectId, outsider.id, JSON.stringify(['project_manager', 'project_lead', 'developer'])]);
    app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const call: Fixture['call'] = (path, auth, body) => fetch(`${base}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth?.bearer ? { Authorization: `Bearer ${auth.bearer}` } : { Origin: base }), 'Content-Type': 'application/json', Cookie: auth?.cookie ?? '', 'X-CSRF-Token': auth?.csrf ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    await verify({ source, base, prefix, teamId, projectId, otherProjectId, admin, leader, developer, outsider, call });
  } finally {
    await app?.close();
    await source.transaction(async (db) => {
      const accounts = z.array(z.object({ id: z.string() })).parse(await db.query('SELECT id FROM accounts WHERE login_name LIKE ?', [`${prefix}.%`]));
      const teams = z.array(z.object({ id: z.string() })).parse(await db.query('SELECT id FROM teams WHERE name LIKE ?', [`${prefix}.%`]));
      // 先解除待建转换来源，避免转换后的任务仍被待建记录引用。
      for (const { id } of teams) await db.query('DELETE b FROM v2_backlog b JOIN projects p ON p.id=b.project_id WHERE p.team_id=?', [id]);
      for (const { id } of accounts) {
        const tasks = z.array(z.object({ id: z.string() })).parse(await db.query('SELECT id FROM v2_tasks WHERE executor_id=? OR creator_id=?', [id, id]));
        for (const task of tasks) { for (const table of ['v2_personal_subtask_events', 'v2_personal_subtasks', 'v2_task_events', 'v2_arrangement_history', 'v2_arrangements', 'v2_placements']) await db.query(`DELETE FROM ${table} WHERE task_id=?`, [task.id]); await db.query('DELETE FROM v2_tasks WHERE id=?', [task.id]); }
        for (const table of ['v2_operations', 'audit_events']) await db.query(`DELETE FROM ${table} WHERE actor_id=?`, [id]);
        for (const table of ['v2_daily_reports', 'v2_personal_preferences', 'v2_categories', 'v2_personal_views']) await db.query(`DELETE FROM ${table} WHERE owner_id=?`, [id]);
        for (const table of ['v2_notifications', 'login_sessions', 'personal_tokens']) await db.query(`DELETE FROM ${table} WHERE account_id=?`, [id]);
      }
      for (const { id } of teams) {
        for (const table of ['v2_backlog', 'v2_milestones', 'project_members']) await db.query(`DELETE t FROM ${table} t JOIN projects p ON p.id=t.project_id WHERE p.team_id=?`, [id]);
        for (const table of ['v2_report_texts', 'v2_shared_orders', 'v2_object_events', 'v2_periods', 'v2_team_settings']) await db.query(`DELETE FROM ${table} WHERE team_id=?`, [id]);
        await db.query('DELETE FROM projects WHERE team_id=?', [id]); await db.query('UPDATE accounts SET team_id=NULL WHERE team_id=?', [id]); await db.query('DELETE FROM teams WHERE id=?', [id]);
      }
      for (const { id } of accounts) await db.query('DELETE FROM accounts WHERE id=?', [id]);
    });
    const remaining = z.array(z.object({ n: z.coerce.number() })).parse(await source.query('SELECT COUNT(*) n FROM accounts WHERE login_name LIKE ?', [`${prefix}.%`]));
    assert.equal(remaining[0]?.n, 0); await source.destroy();
    console.log('Isolated V2 fixture cleanup verified.');
  }
}
