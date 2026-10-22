import { randomUUID } from 'node:crypto';

/** 仅用于浏览器交互回归的内存夹具；不连接数据库，不使用真实账号。 */
export function sortingFixture() {
  const accountId = randomUUID(), teamId = randomUUID(), now = '2026-10-19T00:00:00.000Z';
  const identity = { id: accountId, loginName: 'ui-tester', displayName: '测试负责人', isSuperAdmin: false, mustChangePassword: false, csrfToken: 'test-only' };
  const projects = ['山东', '济南', '青岛', '烟台', '潍坊', '临沂', '威海', '日照'].map((name) => ({ id: randomUUID(), teamId, name, version: 0, members: [{ accountId, roles: ['project_lead'] }], canManage: true, canCreate: true, canConfirmMilestone: true }));
  const periods = [{ id: randomUUID(), teamId, startOn: '2026-10-19', endOn: '2026-10-25', version: 0 }, { id: randomUUID(), teamId, startOn: '2026-10-26', endOn: '2026-11-01', version: 0 }];
  const tasks = projects.flatMap((project) => ['前端页面对接', '统建功能适配生产环境更新', '配合生产测试', '系统库关联接口修改', '后端联调与测试'].map((title, index) => ({ id: randomUUID(), projectId: project.id, teamId, kind: 'project', title, creatorId: accountId, executorId: accountId, priority: 3, status: index % 2 ? 'not_started' : 'in_progress', version: 0, completedAt: null, createdAt: now, updatedAt: now, deletedAt: null, milestoneId: null })));
  const summary = tasks.map((task) => ({ taskId: task.id, projectId: task.projectId, title: task.title, executorId: accountId, executorName: identity.displayName, status: task.status, priority: 3, arranged: true, executed: true, planning: 'planned', historyIncomplete: false }));
  const order = (ids) => ({ ids, version: 0, manual: true });
  const workspace = { team: { id: teamId, name: '交互验证团队', leaderId: accountId, version: 0 }, teamMessages: [], teamVersion: 0, teamLeader: true, today: '2026-10-19', naturalWeekStart: '2026-10-19', accounts: [{ id: accountId, teamId, loginName: identity.loginName, displayName: identity.displayName, disabled: false, version: 0 }], projects, periods, tasks, arrangements: tasks.flatMap((task) => periods.map((period) => ({ taskId: task.id, periodId: period.id, plannedDays: 2, position: 0, version: 0 }))), milestones: [], backlog: [], categories: [], placements: [], personalVersion: 0, orders: [{ scope: 'project-page:projects', ...order(projects.map((p) => p.id)) }, ...projects.map((project) => ({ scope: `project-page:tasks:${project.id}`, ...order(tasks.filter((t) => t.projectId === project.id).map((t) => t.id)) }))] };
  workspace.backlog = ['接口优化', '补充业务校验', '整理验收资料'].map((title) => ({ id: randomUUID(), projectId: projects[1].id, title, priority: 3, creatorId: accountId, version: 0, convertedTaskId: null, deletedAt: null, createdAt: now }));
  workspace.personalPreferences = { completedMode: 'day', projectOrder: null, version: 0 };
  workspace.orders.push({ scope: `project-page:backlog:${projects[1].id}`, ...order(workspace.backlog.map((row) => row.id)) });
  const body = '工作总结（2026-10-19 — 2026-10-25）\n\n' + projects.map((p) => `${p.name}\n- 前端页面对接：进行中\n- 后端联调与测试：未开始`).join('\n\n') + '\n\n下周安排（2026-10-26 — 2026-11-01）\n继续推进联调与验证。';
  const weekly = { summaryPeriod: periods[0], planPeriod: periods[1], summary, projectOrder: order(projects.map((p) => p.id)), taskOrders: projects.flatMap((p) => periods.map((period) => ({ projectId: p.id, periodId: period.id, ...order(tasks.filter((t) => t.projectId === p.id).map((t) => t.id)) }))), text: { body, manual: true, sourceHash: 'a'.repeat(64), version: 0, stale: false }, generatedText: body + '\n新生成内容', currentSourceHash: 'a'.repeat(64), canEditText: true };
  return { identity, workspace, weekly, summary };
}
