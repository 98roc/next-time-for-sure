import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { taskReminderDay, upcomingTaskReminders } from '@ntfs/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service.js';
import { OrganizationRepository } from '../organization/organization.repository.js';
import { messageRetentionDays, notifyTaskReminder } from './notifications.js';
import { canViewTask, type V2Actor } from './permissions.js';
import { V2TaskRepository } from './task.repository.js';
import { V2TaskReminderRepository } from './task-reminder.repository.js';

/** 组织锁内按发送时的执行人和权限写消息，完成、删除、改派与发送顺序明确。 */
export async function sendDueTaskReminders(manager: EntityManager, now: Date): Promise<void> {
  const reminders = new V2TaskReminderRepository(manager);
  if (!await reminders.hasDue(now)) return;

  const organization = new OrganizationRepository(manager);
  await organization.lock();
  const due = await reminders.due(now);
  if (!due.length) return;
  const state = await organization.snapshot();
  const accounts = new Map(state.accounts.map((account) => [account.id, account]));
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  const teamLeaders = new Map(state.teams.map((team) => [team.id, team.leaderId]));
  const tasks = new V2TaskRepository(manager);

  // 中断后每个任务只补最近一次，已超出消息保留期的提醒直接跳过。
  const expiredAt = taskReminderDay(now.getTime(), -messageRetentionDays);
  for (const reminder of due) {
    const task = await tasks.get(reminder.taskId);
    if (!task || task.deletedAt || task.status === 'completed') {
      await reminders.clear(reminder.taskId);
      continue;
    }
    const account = accounts.get(task.executorId);
    const project = task.projectId ? projects.get(task.projectId) : undefined;
    const actor: V2Actor | undefined = account && { ...account, isSuperAdmin: account.isSuperAdmin ?? false };
    const access = project && { ...project, teamLeaderId: teamLeaders.get(project.teamId) ?? '' };
    const upcoming = upcomingTaskReminders(reminder.plan, now.getTime());
    const scheduledAt = taskReminderDay(upcoming.last, -upcoming.count);
    if (scheduledAt > expiredAt && account && actor && canViewTask(actor, task, access)) {
      await notifyTaskReminder(manager, task, account.displayName, project?.name ?? '私人任务', scheduledAt);
    }
    await reminders.advance(task.id, upcoming.first);
  }
}

/** 后台轮询不依赖网页或客户端在线；事务失败由下一轮重试。 */
@Injectable()
export class TaskReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskReminderService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void { if (!this.stopped) this.schedule(0); }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => { void this.poll(); }, delay);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    try {
      await this.database.transaction((manager) => sendDueTaskReminders(manager, new Date()));
    } catch (error) {
      this.logger.warn(`任务定时提醒暂不可用，将在下次重试（${error instanceof Error ? error.name : '未知错误'}）。`);
    } finally {
      if (!this.stopped) this.schedule(10_000);
    }
  }

  onModuleDestroy(): void { this.stopped = true; clearTimeout(this.timer); }
}
