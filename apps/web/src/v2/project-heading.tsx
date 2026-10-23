import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from './workspace';

/** 可见项目共用详情入口；使用站内导航，保留未保存修改的离开保护。 */
export function ProjectLink({ projectId }: { projectId: string }) {
  const { data } = useWorkspace();
  const project = data.projects.find((row) => row.id === projectId);
  if (!project) return null;
  return <Link className="v2-project-link" to={`/work?${new URLSearchParams({ project: projectId, tab: 'tasks' })}`}>{project.name}<span className="v2-project-arrow" aria-hidden="true"> →</span></Link>;
}

/** 项目汇总和周报共用标题条；排序把手、区间统计和业务操作由各入口提供。 */
export function ProjectHeading({ projectId, handle, details, actions, level = 'h3' }: {
  projectId: string;
  handle: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  level?: 'h2' | 'h3';
}) {
  const { data } = useWorkspace();
  const project = data.projects.find((row) => row.id === projectId);
  if (!project) return null;
  const Heading = level;
  const leads = project.members.filter((row) => row.roles.includes('project_lead'))
    .map((row) => data.accounts.find((account) => account.id === row.accountId)?.displayName ?? '历史成员').join('、');

  return <header className="v2-project-heading">
    <div className="v2-project-summary">
      <Heading className="v2-project-title">{handle}<ProjectLink projectId={projectId} /></Heading>
      {details}
    </div>
    <div className="v2-project-actions"><span className="v2-project-leads">研发负责人 {leads || '未设置'}</span>{actions}</div>
  </header>;
}
