import { automaticCarryWeek, carryForward } from './carry-forward.js';
import { ConflictException, Injectable } from '@nestjs/common';
import { publicationRowSchema } from '@ntfs/contracts';
import type { PublicationRow, WeeklyPlanCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { IdentityRepository } from '../identity/identity.repository.js';
import { loadWorkAccess } from '../work/work-access.js';
import { planningCandidates } from './planning-candidates.js';
import { WeeklyPlansRepository } from './weekly-plans.repository.js';
import { AssignmentRepository } from '../work/assignment.repository.js';
import { hasPermission } from '../organization/policy.js';
import type { WeeklyArrangement } from '@ntfs/contracts';
import { planConfirmation, planRows, planSpecial } from './plan-publication.js';
import { ReportingRepository } from './reporting.repository.js';
import { assertTeam, canPublish } from './reporting-policy.js';
import { WorkRepository } from '../work/work.repository.js';

/** 周计划事务编排；共享草稿按负责小组编辑，个人执行事实保持独立。 */
@Injectable()
export class WeeklyPlansService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}
  /** 发布副本仅当前团队可读；草稿权限与发布权限分别处理。 */
  async publications(token: string, team: string, week: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token); assertTeam(access, team);
      const publish = canPublish(access, team);
      const pendingCandidates = [];
      if (publish) for (const project of access.organization.projects.filter((entry) => entry.teamId === team && !entry.archived)) {
        const tasks = (await new WorkRepository(manager).snapshot(project.id)).tasks;
        for (const task of tasks.filter((entry) => !['completed', 'cancelled'].includes(entry.status) && !tasks.some((child) => child.parentId === entry.id))) pendingCandidates.push({ id: task.id, version: task.version, title: `${project.name} · ${task.title}` });
      }
      return { publications: await new ReportingRepository(manager).publications(team, week, 'plan'), canPublish: publish, canEdit: publish || access.organization.groups.some((group) => group.teamId === team && hasPermission(access.actor, access.organization, 'work.assign', { teamId: team, groupId: group.id })), pendingCandidates };
    });
  }
  /** 发布预览摘要绑定当前全团队计划。 */
  async preview(token: string, team: string, week: string) {
    return this.database.transaction(async (manager) => { const access = await loadWorkAccess(manager, this.identity, token); if (canPublish(access, team) && automaticCarryWeek(week)) await carryForward(manager, access, team, week); return { confirmation: await planConfirmation(manager, access, team, week), rows: await planRows(manager, access, team, week) }; });
  }

  /** 查询当前可安排分工，不隐式创建草稿。 */
  async candidates(token: string, teamId: string, week: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      return { teamId, week, assignments: await planningCandidates(manager, access, teamId) };
    });
  }

  /** 草稿按当前负责小组裁剪；本周和下周惰性补入未完成工作，不改写历史或发布副本。 */
  async draft(token: string, teamId: string, week: string) {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token);
      await planningCandidates(manager, access, teamId);
      if (automaticCarryWeek(week)) await carryForward(manager, access, teamId, week);
      const repository = new WeeklyPlansRepository(manager);
      const draft = await repository.draft(teamId, week);
      if (!draft) return null;
      const arrangements: WeeklyArrangement[] = [];
      for (const entry of await repository.arrangements(draft.id)) {
        const assignment = await new AssignmentRepository(manager).assignment(entry.assignmentId);
        if (assignment && hasPermission(access.actor, access.organization, 'work.assign', { teamId, groupId: assignment.groupId })) arrangements.push(entry);
      }
      const allRows = await planRows(manager, access, teamId, week);
      const latest = (await new ReportingRepository(manager).publications(teamId, week, 'plan'))[0];
      // 比较实际发布内容，不因行顺序或无效重复保存提示新调整；仅返回布尔值而不泄漏其他组草稿。
      const canonical = (entries: PublicationRow[]) => JSON.stringify(entries.map((entry) => JSON.stringify(publicationRowSchema.parse(entry))).sort());
      const hasUnpublishedChanges = Boolean(latest && canonical(allRows) !== canonical(latest.rows));
      const rows = allRows.filter((entry) => entry.groupId ? hasPermission(access.actor, access.organization, 'work.assign', { teamId, groupId: entry.groupId }) : hasPermission(access.actor, access.organization, 'work.assign', { teamId }));
      return { ...draft, hasUnpublishedChanges, arrangements, rows, pending: hasPermission(access.actor, access.organization, 'work.assign', { teamId }) ? await repository.pending(draft.id) : [] };
    });
  }

  /** 逐条版本保护人工编辑；结转只补入缺失且仍有效的前周分工。 */
  async execute(token: string, csrf: string, command: WeeklyPlanCommand): Promise<{ objectId: string }> {
    return this.database.transaction(async (manager) => {
      const access = await loadWorkAccess(manager, this.identity, token, csrf);
      const candidates = await planningCandidates(manager, access, command.teamId);
      const repository = new WeeklyPlansRepository(manager);
      if (automaticCarryWeek(command.week) || command.action === 'carry_forward') await carryForward(manager, access, command.teamId, command.week);
      const draftId = await repository.ensure(command.teamId, command.week);
      const existing = await repository.arrangements(draftId);
      let objectId = draftId;
      const before = { arrangements: existing, pending: await repository.pending(draftId) };
      const special = await planSpecial(manager, access, command, draftId);

      // 保存时重验分工及任务版本，避免把已停止或跨组调整后的责任继续安排。
      if (special) objectId = special;
      else if (command.action === 'save_arrangement' || command.action === 'save_arrangements') {
        const rows = command.action === 'save_arrangements' ? command.arrangements : [command];
        for (const row of rows) {
          const candidate = candidates.find((entry) => entry.assignmentId === row.assignmentId);
          if (!candidate) throw new ConflictException('分工不可安排或不在当前负责小组范围，请刷新。');
          if (candidate.assignmentVersion !== row.assignmentVersion || candidate.taskVersion !== row.taskVersion) throw new ConflictException('任务或分工已变化，请刷新后安排。');
          const previous = existing.find((entry) => entry.assignmentId === row.assignmentId);
          if ((previous?.version ?? null) !== row.version) throw new ConflictException('周安排已变化，请刷新后编辑。');
          await repository.include(draftId, row.assignmentId, 'assignment');
          objectId = await repository.save(draftId, row.assignmentId, row, previous);
        }
      } else if (command.action === 'move_arrangement') {
        if (command.targetWeek === command.week) throw new ConflictException('目标周必须与当前周不同。');
        const source = existing.find((entry) => entry.id === command.arrangementId);
        if (!source || source.version !== command.version || !candidates.some((entry) => entry.assignmentId === source.assignmentId)) throw new ConflictException('安排已变化或无权调整，请刷新。');
        if (automaticCarryWeek(command.targetWeek)) await carryForward(manager, access, command.teamId, command.targetWeek);
        const targetId = await repository.ensure(command.teamId, command.targetWeek);
        const target = (await repository.arrangements(targetId)).find((entry) => entry.assignmentId === source.assignmentId);
        if ((target?.version ?? null) !== command.targetVersion) throw new ConflictException('目标周安排已变化，请刷新后再移动。');
        // 自动延续的空壳尚无人工编辑，可带入来源内容；目标周已有人工安排则完整保留。
        const untouchedCarry = target?.sourceWeek && target.version === 0 && !target.goal && target.expectedProgress === null && target.plannedDays === null;
        await repository.include(targetId, source.assignmentId, 'assignment');
        objectId = target && !untouchedCarry ? target.id : await repository.save(targetId, source.assignmentId, source, target);
        await repository.exclude(draftId, source.assignmentId, 'assignment');
        await repository.remove(draftId, source.id, false);
        await new ReportingRepository(manager).event(command.teamId, access.actor.id, 'move_arrangement_target', { command, before: target ?? null, after: (await repository.arrangements(targetId)).find((entry) => entry.id === objectId) });
      }
      await new IdentityRepository(manager).audit(access.actor.id, `weekly.${command.action}`, objectId);
      await new ReportingRepository(manager).event(command.teamId, access.actor.id, command.action, { command, before, after: { arrangements: await repository.arrangements(draftId), pending: await repository.pending(draftId) } });
      return { objectId };
    });
  }
}
