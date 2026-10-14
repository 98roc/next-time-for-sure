import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ReportCommand, ReportEntry, ReportSource, PublicationRow } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { digest } from '../identity/password.js';
import { loadWorkAccess } from '../work/work-access.js';
import { ReportingRepository } from './reporting.repository.js';
import { assertTeam, canEditSource, canPublish } from './reporting-policy.js';
import { reportSources } from './report-sources.js';
import { planRows } from './plan-publication.js';

/** 周报人工整理与原始执行记录隔离；重生成只纳入新来源。 */
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 已发布内容全团队可读；无整理权限的成员不接收草稿或来源。 */
  async state(token: string, team: string, week: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); assertTeam(access, team);
      const repository = new ReportingRepository(manager); const draft = await repository.report(team, week);
      const all = await reportSources(manager, access, team, week);
      const editable = await sourceEditor(repository, access, team, [...all, ...(draft?.entries.flatMap((entry) => entry.sources) ?? [])]);
      const current = all.filter(editable);
      const entries = draft?.entries.filter((entry) => entry.sources.every(editable)) ?? [];
      const allowed = canPublish(access, team) || access.organization.groups.some((group) => canEditSource(access, team, { groupId: group.id, ownerId: null }));
      return { sources: all.filter((source) => editable(source) || source.ownerId === access.actor.id), canPublish: canPublish(access, team), canEdit: allowed, publications: await repository.publications(team, week, 'report'), draft: allowed && draft ? { id: draft.id, version: draft.version, entries, changedKeys: changed(entries, current), newCount: current.filter((source) => !entries.some((entry) => entry.sources.some((old) => old.key === source.key))).length } : null };
    });
  }
  /** 确认摘要包括草稿、当前来源和下周安排。 */
  async preview(token: string, team: string, week: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); assertTeam(access, team);
      if (!canPublish(access, team)) throw new ForbiddenException('仅团队负责人可以发布周报。');
      const draft = await new ReportingRepository(manager).report(team, week); const sources = await reportSources(manager, access, team, week); const next = await planRows(manager, access, team, nextWeek(week));
      return { confirmation: digest(JSON.stringify({ draft, sources, next })), rows: reportRows(draft?.entries ?? []), next };
    });
  }
  /** 保存、合并、排除和发布逐次校验范围、版本与当前源记录。 */
  async execute(token: string, csrf: string, command: ReportCommand) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf); assertTeam(access, command.teamId);
      const repository = new ReportingRepository(manager); const before = await repository.report(command.teamId, command.week);
      const sources = await reportSources(manager, access, command.teamId, command.week);
      const editable = await sourceEditor(repository, access, command.teamId, [...sources, ...(before?.entries.flatMap((entry) => entry.sources) ?? [])]);
      const entries = structuredClone(before?.entries ?? []);
      let objectId = before?.id ?? '';
      if ('version' in command && command.version !== before?.version) throw new ConflictException('周报草稿已变化，请刷新。');
      if (command.action === 'generate') {
        if (!canPublish(access, command.teamId) && !access.organization.groups.some((group) => canEditSource(access, command.teamId, { groupId: group.id, ownerId: null }))) throw new ForbiddenException('没有周报整理权限。');
        for (const source of sources.filter(editable)) {
          if (entries.some((entry) => entry.sources.some((old) => old.key === source.key))) continue;
          entries.push({ id: randomUUID(), projectId: source.projectId, projectName: source.projectName, taskId: source.taskId, title: source.title, text: source.text, excluded: false, edited: false, sources: [source] });
        }
      } else if (command.action === 'reassign_week') {
        const source = sources.find((entry) => entry.sourceKind === command.sourceKind && entry.sourceId === command.sourceId);
        if (!source || (!editable(source) && source.ownerId !== access.actor.id)) throw new ForbiddenException('无权调整来源归属周。');
        if (source.hash !== command.sourceHash) throw new ConflictException('来源已变化，请重新读取。');
        await repository.reassign(command.sourceKind, command.sourceId, command.targetWeek);
        await repository.event(command.teamId, access.actor.id, command.action, { before: source, targetWeek: command.targetWeek });
        return { objectId: command.sourceId };
      } else if (command.action === 'publish') {
        if (!canPublish(access, command.teamId)) throw new ForbiddenException('仅团队负责人可以发布周报。');
        const next = await planRows(manager, access, command.teamId, nextWeek(command.week));
        const confirmation = digest(JSON.stringify({ draft: before, sources, next }));
        if (!before || confirmation !== command.confirmation) throw new ConflictException('发布范围已变化，请重新预览。');
        if (changed(entries.filter((entry) => !entry.excluded), sources).length) throw new ConflictException('已有来源发生变化，请确认整理内容后发布。');
        if (sources.some((source) => !entries.some((entry) => entry.sources.some((old) => old.key === source.key)))) throw new ConflictException('还有新增来源，请重新生成并整理后发布。');
        objectId = await repository.publish(command.teamId, command.week, 'report', reportRows(entries), next, command.reason, command.confirmation);
      } else {
        const ids = command.action === 'edit' ? [command.entryId] : command.entryIds;
        const selected = entries.filter((entry) => ids.includes(entry.id));
        if (new Set(ids).size !== ids.length || selected.length !== ids.length || selected.some((entry) => !entry.sources.every(editable))) throw new ForbiddenException('不能跨范围整理或合并。');
        if (command.action === 'edit') {
          const entry = selected[0]; if (!entry) throw new ConflictException('条目已变化。');
          entry.text = command.text; entry.excluded = command.excluded; entry.edited = true;
          if (command.acceptChanges) {
            entry.sources = entry.sources.map((old) => sources.find((source) => source.key === old.key) ?? { ...old, hash: 'removed' });
            const first = entry.sources[0];
            if (first && entry.sources.every((source) => source.taskId === first.taskId && source.projectId === first.projectId)) { entry.taskId = first.taskId; entry.projectId = first.projectId; entry.projectName = first.projectName; entry.title = first.title; }
          }
        } else {
          const first = selected[0]; if (!first || selected.some((entry) => entry.projectId !== first.projectId || entry.taskId !== first.taskId)) throw new ConflictException('仅合并同项目同任务的零散汇报。');
          const merged = { ...first, id: randomUUID(), text: command.text, edited: true, excluded: false, sources: selected.flatMap((entry) => entry.sources) };
          entries.splice(0, entries.length, ...entries.filter((entry) => !ids.includes(entry.id)), merged);
        }
      }
      if (command.action !== 'publish') objectId = await repository.saveReport(command.teamId, command.week, entries);
      await repository.event(command.teamId, access.actor.id, `report.${command.action}`, { before, after: command.action === 'publish' ? { publicationId: objectId } : entries });
      return { objectId };
    });
  }
}
/** 源记录离开本周也要提示；明确接受离开后不持续阻止发布。 */
function changed(entries: ReportEntry[], current: ReportSource[]) { return entries.flatMap((entry) => entry.sources.filter((old) => { const source = current.find((item) => item.key === old.key); return source ? source.hash !== old.hash : old.hash !== 'removed'; }).map((source) => source.key)); }
/** 相同任务按一行汇总并保留人员文字和来源映射，不再复制父任务汇总。 */
function reportRows(entries: ReportEntry[]): PublicationRow[] {
  const rows = new Map<string, PublicationRow>();
  for (const entry of entries.filter((item) => !item.excluded)) {
    const key = `${entry.projectId}:${entry.taskId ?? entry.id}`;
    const people = [...new Set(entry.sources.map((source) => source.person))].join('、');
    const line = `${people}：${entry.text}`;
    const row = rows.get(key);
    if (row) { if (!row.text.split('\n').includes(line)) row.text += `\n${line}`; row.sourceIds.push(...entry.sources.map((source) => source.key)); }
    else rows.set(key, { projectId: entry.projectId, projectName: entry.projectName, taskId: entry.taskId, title: entry.title, accountId: null, person: '', groupId: null, text: line, plannedDays: null, status: '', sourceIds: entry.sources.map((source) => source.key) });
  }
  return [...rows.values()];
}
/** 周次使用UTC日期运算，避免夏令时或本地时区偏移。 */
function nextWeek(week: string) { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 7); return date.toISOString().slice(0, 10); }

/** 源记录即使调离本周，也以数据库当前归属决定是否可整理。 */
async function sourceEditor(repository: ReportingRepository, access: import('../work/work-access.js').WorkAccess, team: string, sources: ReportSource[]) {
  const allowed = new Set<string>();
  for (const source of new Map(sources.map((entry) => [entry.key, entry])).values()) {
    const scope = await repository.authority(source);
    if (scope?.teamId === team && canEditSource(access, team, scope)) allowed.add(source.key);
  }
  return (source: ReportSource) => allowed.has(source.key);
}
