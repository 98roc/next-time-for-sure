import type { Identity, V2Workspace } from '@ntfs/contracts';
import { Field } from './controls';

export const otherTaskSource = 'others';

/** 新建入口仅列出当前身份可实际使用的来源；安排他人限可管理项目中的已启用成员。 */
export function taskSourceProjects(data: V2Workspace, user: Identity) {
  return {
    own: data.projects.filter((project) => project.canCreate && (user.isSuperAdmin || project.members.some((member) => member.accountId === user.id))),
    others: data.projects.filter((project) => project.canManage && project.members.some((member) => member.accountId !== user.id && data.accounts.some((account) => account.id === member.accountId && !account.disabled))),
  };
}

/** 保持现有项目来源列表，给他人的入口紧跟个人来源；项目选择和任务字段复用原创建流程。 */
export function TaskCreateSource({ source, projectId, projects, onSource, onProject }: {
  source: string; projectId: string; projects: ReturnType<typeof taskSourceProjects>;
  onSource: (source: string) => void; onProject: (projectId: string) => void;
}) {
  return <>
    <Field label="任务来源" full><select aria-label="任务来源" value={source} onChange={(event) => onSource(event.target.value)}>
      <option value="private">个人 · 仅自己可见</option>
      {projects.others.length > 0 && <option value={otherTaskSource}>他人 · 项目任务</option>}
      {projects.own.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></Field>
    {source === otherTaskSource && <Field label="项目" full><select aria-label="项目" required value={projectId} onChange={(event) => onProject(event.target.value)}>
      <option value="">请选择项目</option>
      {projects.others.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></Field>}
  </>;
}
