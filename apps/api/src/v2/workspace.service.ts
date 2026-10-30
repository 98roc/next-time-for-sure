import { rolloverTeam } from './task-rollover.js';
import { v2PeriodWindowLimits } from '@ntfs/contracts';
import { readMessages } from './notifications.js';
import { PersonalWorkRepository } from './personal-work.repository.js';
import { readProjectOrders } from './project-orders.js';
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { V2ImpactIntent, V2MemberImpactInput, V2PersonalCommand, V2PlanningCommand, V2ProjectCommand, V2ReportCommand, V2TaskCommand, V2TaskEdit, V2TeamCommand, V2Workspace } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { loadV2Context, requireVersion } from './context.js';
import { naturalWeek, shanghaiDate } from './calendar.js';
import { canCreateProjectTask, canManageProject, canParticipateProject, canConfirmMilestone } from './permissions.js';
import { authorizeProjectCommand, authorizeTaskCommand, requireTask } from './authorization.js';
import { V2TaskRepository } from './task.repository.js';
import { V2PersonalRepository } from './personal.repository.js';
import { V2PlanningRepository } from './planning.repository.js';
import { V2ProjectRepository } from './project.repository.js';
import { executeOnce } from './repository-utils.js';
import { mutateTask } from './task-mutations.js';
import { mutateProject } from './project-mutations.js';
import { mutatePersonal } from './personal-mutations.js';
import { authorizePlanning, mutatePlanning, mutateReport } from './planning-mutations.js';
import { previewImpact, requireConfirmation } from './impact.js';
import { buildWeeklyState } from './weekly-state.js';
import { memberImpact, mutateTeam, requireTeamLeader } from './team-management.js';
import { authorizeEdit, saveTask } from './task-edit.js';
import { summarizePeriod } from './history.js';
import { V2PlanningLabelsRepository } from './planning-labels.repository.js';

/** V2 工作区统一事务边界，所有入口包含 Token 都重读当前身份与权限。 */
@Injectable()
export class V2WorkspaceService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 消息不续期会话，每次按当前项目权限裁剪。 */
  async messages(token: string, page: number, after?: string) {
    return this.database.transaction(async (manager) => readMessages(manager, await loadV2Context(manager, this.identity, token), page, after));
  }

  /** 单次快照保证项目、个人与计划引用相同任务；其他人的私人分类不会返回。 */
  async snapshot(token: string, teamId?: string): Promise<V2Workspace> {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, undefined, teamId ?? null), today = shanghaiDate(new Date().toISOString());
      const personal = new V2PersonalRepository(manager), planning = new V2PlanningRepository(manager), projects = new V2ProjectRepository(manager), tasks = new V2TaskRepository(manager);
      await personal.ensure(context.actor.id);
      if (context.teamId) await rolloverTeam(manager, context.teamId);
      const projectIds = context.projects.map((project) => project.id), visible = await tasks.visible(context.actor.id, projectIds);
      const settings = context.teamId ? await planning.settings(context.teamId) : { messages: [], version: 0 };
      return {
        teams: context.organization.teams.filter((team) => context.actor.isSuperAdmin || team.id === context.actor.teamId),
        planningLabels: await new V2PlanningLabelsRepository(manager).read(visible.map((task) => task.id)),
        periodWindow: context.teamId ? await planning.periodWindow(context.teamId) : { before: v2PeriodWindowLimits.before, after: v2PeriodWindowLimits.after, version: 0 },
        personalPreferences: await new PersonalWorkRepository(manager).preferences(context.actor.id),
        orders: await readProjectOrders(manager, context),
        team: context.organization.teams.find((team) => team.id === context.teamId) ?? null, teamMessages: settings.messages, teamVersion: settings.version, teamLeader: context.teamLeader, today, naturalWeekStart: naturalWeek(today).startOn,
        accounts: context.organization.accounts.filter((account) => (account.teamId === context.teamId && context.teamId !== null) || (context.actor.isSuperAdmin && account.id === context.actor.id)),
        projects: context.projects.map((project) => ({ id: project.id, teamId: project.teamId, name: context.organization.projects.find((entry) => entry.id === project.id)?.name ?? '', version: context.organization.projects.find((entry) => entry.id === project.id)?.version ?? 0, members: project.members, canContribute: canParticipateProject(context.actor, project), canManage: canManageProject(context.actor, project), canCreate: canCreateProjectTask(context.actor, project, context.actor.id) || canManageProject(context.actor, project), canConfirmMilestone: canConfirmMilestone(context.actor, { projectId: project.id }, project) })),
        periods: context.teamId ? await planning.periods(context.teamId) : [], tasks: visible, arrangements: await tasks.arrangements(visible.map((task) => task.id)), milestones: await projects.milestones(projectIds), backlog: await projects.backlog(projectIds),
        categories: await personal.categories(context.actor.id), placements: (await personal.placements(context.actor.id)).filter((row) => visible.some((task) => task.id === row.taskId && task.executorId === context.actor.id)), personalVersion: await personal.version(context.actor.id),
      };
    });
  }

  /** 影响预览无业务写入，数据更新后摘要失效。 */
  async impact(token: string, intent: V2ImpactIntent, teamId?: string) { return this.database.transaction(async (manager) => previewImpact(manager, await loadV2Context(manager, this.identity, token, undefined, teamId), intent, shanghaiDate(new Date().toISOString()))); }

  /** 历史按当前项目权限重新裁剪，私人历史仅本人可查。 */
  async history(token: string, taskId: string) { return this.database.transaction(async (manager) => { const context = await loadV2Context(manager, this.identity, token), repository = new V2TaskRepository(manager); requireTask(context, await repository.get(taskId)); return repository.history([taskId]); }); }

  /** 任务命令先鉴权再幂等；版本及影响在幂等首次执行中校验。 */
  async task(token: string, csrf: string, command: V2TaskCommand) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf), repository = new V2TaskRepository(manager);
      const task = 'taskId' in command ? await repository.get(command.taskId) : undefined;
      context.operationId = command.operationId;
      authorizeTaskCommand(context, command, task);
      return executeOnce(manager, context.actor.id, command, async () => {
        if (task && 'version' in command) requireVersion(task.version, command.version);
        const today = shanghaiDate(new Date().toISOString());
        if (command.action === 'update_project' && task?.milestoneId && task.milestoneId !== command.milestoneId) await requireConfirmation(manager, context, { action: 'unlink_milestone', taskId: task.id, version: command.version }, command.milestoneConfirmation ?? '', today);
        if (command.action === 'delete') await requireConfirmation(manager, context, { action: 'delete_task', taskId: command.taskId, version: command.version }, command.confirmation, today);
        if (command.action === 'remove_arrangement') await requireConfirmation(manager, context, { action: command.action, taskId: command.taskId, version: command.version, periodId: command.periodId }, command.confirmation, today);
        if (command.action === 'change_arrangement') await requireConfirmation(manager, context, { action: command.action, taskId: command.taskId, version: command.version, periodId: command.periodId, targetPeriodId: command.targetPeriodId }, command.confirmation, today);
        return { objectIds: await mutateTask(manager, context, command, task) };
      });
    });
  }

  /** 待建和里程碑共用项目权限，转换复用任务创建事务。 */
  async project(token: string, csrf: string, command: V2ProjectCommand) {
    return this.database.transaction(async (manager) => { const context = await loadV2Context(manager, this.identity, token, csrf); context.operationId = command.operationId; await authorizeProjectCommand(manager, context, command); return executeOnce(manager, context.actor.id, command, async () => ({ objectIds: await mutateProject(manager, context, command, shanghaiDate(new Date().toISOString())) })); });
  }

  /** 个人视图只处理当前用户，不接受客户端 ownerId。 */
  async personal(token: string, csrf: string, command: V2PersonalCommand) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf);
      context.operationId = command.operationId;
      if ('taskId' in command && requireTask(context, await new V2TaskRepository(manager).get(command.taskId)).executorId !== context.actor.id) throw new ForbiddenException('只能调整本人执行任务的个人视图。');
      return executeOnce(manager, context.actor.id, command, async () => ({ objectIds: await mutatePersonal(manager, context, command, shanghaiDate(new Date().toISOString())) }));
    });
  }

  /** 周报只读事实与安排，切换区间不会创建任务或自动结转。 */
  async weekly(token: string, summaryPeriodId: string, planPeriodId: string, teamId?: string) { return this.database.transaction(async (manager) => (await buildWeeklyState(manager, await loadV2Context(manager, this.identity, token, undefined, teamId ?? null), summaryPeriodId, planPeriodId)).state); }

  /** 项目总览与周报使用同一历史计算，不以当前状态覆盖已结束区间。 */
  async summary(token: string, periodId: string, teamId?: string) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, undefined, teamId ?? null), tasks = new V2TaskRepository(manager), planning = new V2PlanningRepository(manager);
      const period = context.teamId ? (await planning.periods(context.teamId)).find((row) => row.id === periodId) : undefined;
      if (!period) throw new ConflictException('日期区间不存在。');
      const ids = await tasks.projectTaskIds(context.projects.map((row) => row.id));
      return summarizePeriod(period, await tasks.history(ids), await planning.arrangementHistory(ids), new Date().toISOString(), await new V2PlanningLabelsRepository(manager).read(ids));
    });
  }

  /** 共享排序及日期修改在同一事务检查作用域、影响与版本。 */
  async planning(token: string, csrf: string, command: V2PlanningCommand, teamId?: string) { return this.database.transaction(async (manager) => { const context = await loadV2Context(manager, this.identity, token, csrf, teamId ?? null); authorizePlanning(context, command); return executeOnce(manager, context.actor.id, command, async () => ({ objectIds: await mutatePlanning(manager, context, command, shanghaiDate(new Date().toISOString())) })); }); }

  /** 不让受限成员通过已知幂等键读取或修改全团队共享稿。 */
  async report(token: string, csrf: string, command: V2ReportCommand, teamId?: string) { return this.database.transaction(async (manager) => { const context = await loadV2Context(manager, this.identity, token, csrf, teamId ?? null); requireTeamLeader(context); return executeOnce(manager, context.actor.id, command, async () => ({ objectIds: await mutateReport(manager, context, command) })); }); }

  /** 项目成员移出前列出本项目全部阻塞项。 */
  async membersImpact(token: string, input: V2MemberImpactInput, teamId?: string) { return this.database.transaction(async (manager) => memberImpact(manager, await loadV2Context(manager, this.identity, token, undefined, teamId), input)); }

  /** 团队配置与任务分配共享事务锁，每次提交重算移出限制。 */
  async team(token: string, csrf: string, command: V2TeamCommand, teamId?: string) { return this.database.transaction(async (manager) => { const context = await loadV2Context(manager, this.identity, token, csrf, teamId ?? null); requireTeamLeader(context); return executeOnce(manager, context.actor.id, command, async () => ({ objectIds: await mutateTeam(manager, context, command) })); }); }

  /** 共用弹窗的业务字段、状态和区间一次原子提交。 */
  async edit(token: string, csrf: string, command: V2TaskEdit) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf), task = requireTask(context, await new V2TaskRepository(manager).get(command.taskId));
      context.operationId = command.operationId;
      authorizeEdit(context, task, command);
      return executeOnce(manager, context.actor.id, command, async () => {
        requireVersion(task.version, command.version);
        if (command.details?.kind === 'project' && task.milestoneId && task.milestoneId !== command.details.milestoneId) await requireConfirmation(manager, context, { action: 'unlink_milestone', taskId: task.id, version: command.version }, command.milestoneConfirmation ?? '', shanghaiDate(new Date().toISOString()));
        if (command.arrangement) await requireConfirmation(manager, context, { action: 'change_arrangement', taskId: task.id, version: command.version, periodId: command.arrangement.periodId, targetPeriodId: command.arrangement.targetPeriodId }, command.arrangement.confirmation, shanghaiDate(new Date().toISOString()));
        await saveTask(manager, context, task, command); return { objectIds: [task.id] };
      });
    });
  }

}
