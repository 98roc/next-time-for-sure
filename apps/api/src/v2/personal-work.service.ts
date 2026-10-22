import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { V2DailyCommand, V2PersonalSettingsCommand, V2SubtasksCommand } from '@ntfs/contracts';
import { DatabaseService } from '../database/database.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { loadV2Context, requireVersion, checkRule, type V2Context } from './context.js';
import { requireTask } from './authorization.js';
import { V2TaskRepository } from './task.repository.js';
import { PersonalWorkRepository } from './personal-work.repository.js';
import { executeOnce } from './repository-utils.js';
import { buildDailyReport, dailyProjects } from './daily-report.js';
import { editReport } from './shared-report.js';

/** 子任务管理只允许当前执行人；负责人身份和主任务可见性均不能代替私人授权。 */
async function ownTask(manager: EntityManager, context: V2Context, taskId: string) {
  const task = requireTask(context, await new V2TaskRepository(manager).get(taskId));
  if (task.deletedAt || task.executorId !== context.actor.id) throw new ForbiddenException('只能维护本人当前执行任务的私人子任务。');
  return task;
}

/** 私人清单、偏好及日报复用工作区身份、事务、幂等与乐观并发边界。 */
@Injectable()
export class PersonalWorkService {
  constructor(private readonly database: DatabaseService, private readonly identity: IdentityService) {}

  /** 每次读取都重查任务的当前权限及执行人，不向改派后的新执行人返回旧清单。 */
  async subtasks(token: string, taskId: string) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token);
      await ownTask(manager, context, taskId);
      return new PersonalWorkRepository(manager).subtasks(context.actor.id, taskId);
    });
  }

  /** 一次保存新增、编辑、删除与顺序，删除集合须明确声明且与当前清单一致。 */
  async saveSubtasks(token: string, csrf: string, command: V2SubtasksCommand) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf), task = await ownTask(manager, context, command.taskId);
      const repository = new PersonalWorkRepository(manager), ownerId = context.actor.id;
      return executeOnce(manager, ownerId, command, async () => {
        const current = await repository.subtasks(ownerId, task.id);
        requireVersion(current.version, command.version);
        const removed = current.items.filter((item) => !command.items.some((next) => next.id === item.id)).map((item) => item.id);
        if (removed.length !== command.removedIds.length || removed.some((id) => !command.removedIds.includes(id))) throw new ConflictException('删除项已变化，请重新核对并确认。');

        // 完成时间只由服务端赋值；已完成项改名或重排不会重新计入今天。
        const now = new Date().toISOString();
        const items = command.items.map((item) => {
          const previous = current.items.find((row) => row.id === item.id);
          return { ...item, completedAt: item.completed ? previous?.completedAt ?? now : null };
        });
        await repository.saveSubtasks(ownerId, { taskId: task.id, taskTitle: task.title, projectId: task.projectId, projectName: context.organization.projects.find((row) => row.id === task.projectId)?.name ?? '', items, version: current.version + 1 }, now);
        return { objectIds: [task.id] };
      });
    });
  }

  /** 不接收 ownerId，查询本人日末快照及本人手工文字。 */
  async daily(token: string, on: string) {
    return this.database.transaction(async (manager) => buildDailyReport(manager, await loadV2Context(manager, this.identity, token), on));
  }

  /** 手工文字保留编辑开始时来源；重新生成和核对必须绑定最新来源及稿件版本。 */
  async saveDaily(token: string, csrf: string, command: V2DailyCommand) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf), repository = new PersonalWorkRepository(manager);
      return executeOnce(manager, context.actor.id, command, async () => {
        const state = await buildDailyReport(manager, context, command.on);
        requireVersion(state.text.version, command.version);
        if (command.action !== 'save_daily' && command.sourceHash !== state.currentSourceHash) throw new ConflictException('完成记录或排序已变化，请更新预览后再次确认。');
        const report = command.action === 'save_daily'
          ? checkRule(() => editReport(state.text, command.version, command.body, command.sourceHash))
          : { body: command.action === 'regenerate_daily' ? state.generatedText : state.text.body, manual: command.action !== 'regenerate_daily' && state.text.manual, sourceHash: state.currentSourceHash, version: command.version + 1 };
        await repository.saveReport(context.actor.id, command.on, report);
        return { objectIds: [context.actor.id] };
      });
    });
  }

  /** 模式与排序共用个人偏好版本，保存一项时不覆盖另一项；排序只接受有权项目全量集合。 */
  async settings(token: string, csrf: string, command: V2PersonalSettingsCommand) {
    return this.database.transaction(async (manager) => {
      const context = await loadV2Context(manager, this.identity, token, csrf), repository = new PersonalWorkRepository(manager);
      const projects = command.action === 'set_daily_project_order' ? await dailyProjects(manager, context) : [];
      if (command.action === 'set_daily_project_order' && command.projectIds !== null && (new Set(command.projectIds).size !== command.projectIds.length || command.projectIds.length !== projects.length || command.projectIds.some((id) => !projects.some((row) => row.id === id)))) throw new ForbiddenException('请完整排序当前可见项目，不能包含其他项目。');
      return executeOnce(manager, context.actor.id, command, async () => {
        const previous = await repository.preferences(context.actor.id);
        requireVersion(previous.version, command.version);
        await repository.savePreferences(context.actor.id, { ...previous, version: previous.version + 1, ...(command.action === 'set_completed_mode' ? { completedMode: command.mode } : { projectOrder: command.projectIds }) });
        return { objectIds: [context.actor.id] };
      });
    });
  }
}
