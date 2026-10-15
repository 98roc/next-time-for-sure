import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectRoleSchema } from '@ntfs/contracts';
import type { OrganizationCommand, OrganizationSnapshot } from '@ntfs/contracts';
import { Link } from 'react-router-dom';
import { Dialog } from '../layout/dialog';
import { organizationCommand, organizationSnapshot } from './api';
import { roleLabels } from './command-form';

type Project = OrganizationSnapshot['projects'][number];
type BatchCommand = Extract<OrganizationCommand, { action: 'set_project_members' }>;
type Roles = BatchCommand['members'][number]['roles'];
type Draft = { base: Project; changes: Record<string, Roles> };

/** 成员多选与角色同行编辑；一次提交增量，固定首个修改时的版本，失败保留全部选择。 */
export function ProjectMembersDialog({ projectId, accountId, csrf, onClose }: {
  projectId: string; accountId: string; csrf: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['organization', accountId], queryFn: organizationSnapshot, retry: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState('');
  const currentProject = query.data?.projects.find((entry) => entry.id === projectId);
  const project = draft?.base ?? currentProject;
  const accounts = query.data?.accounts ?? [];
  const changes = Object.entries(draft?.changes ?? {}).map(([id, roles]) => ({ accountId: id, roles }));
  const additions = changes.filter((entry) => !project?.members.some((member) => member.accountId === entry.accountId));
  const invalid = changes.some((entry) => !entry.roles.length);
  const keyword = search.trim().toLocaleLowerCase();
  const save = useMutation({
    mutationFn: (command: BatchCommand) => organizationCommand(command, csrf),
    onSuccess: async () => {
      await Promise.all(['organization', 'work', 'overview', 'identity'].map((key) => client.invalidateQueries({ queryKey: [key] })));
      onClose();
    },
  });

  /** 取消新成员选择或恢复原角色时移除增量，搜索不会丢失隐藏行的选择。 */
  function change(id: string, roles: Roles | null) {
    if (!project) return;
    save.reset();
    const next = { ...draft?.changes };
    const original = project.members.find((member) => member.accountId === id)?.roles;
    if (roles === null || (original && original.length === roles.length && original.every((role) => roles.includes(role)))) delete next[id];
    else next[id] = roles;
    setDraft(Object.keys(next).length ? { base: project, changes: next } : null);
  }

  // 已加入成员优先；历史或停用成员只读，移出仍需走交接流程。
  const rows = project ? [
    ...project.members.map((member) => ({ id: member.accountId, existing: true })),
    ...accounts.filter((person) => person.teamId === project.teamId && !person.disabled && !project.members.some((member) => member.accountId === person.id)).map((person) => ({ id: person.id, existing: false })),
  ].filter(({ id }) => {
    const person = accounts.find((entry) => entry.id === id);
    return `${person?.displayName ?? '历史成员'} ${person?.loginName ?? ''}`.toLocaleLowerCase().includes(keyword);
  }) : [];

  return <Dialog className="project-members-dialog" title={project ? `${project.name} · 项目成员` : '项目成员'} busy={save.isPending} onClose={onClose}>
    <div className="project-members">
      {query.isPending && <p role="status">正在加载项目成员…</p>}
      {query.isError && <p role="alert" className="form-error">成员读取失败。<button onClick={() => { void query.refetch(); }}>重新加载</button></p>}
      {!query.isPending && !query.isError && !currentProject && <p role="alert">项目不存在或已无查看权限，请关闭后刷新列表。</p>}
      {project && <form className="project-members-form" onSubmit={(event) => {
        event.preventDefault();
        if (!changes.length || invalid || !currentProject || query.isError) return;
        save.mutate({ action: 'set_project_members', projectId, version: project.version, members: changes });
      }}>
        <p className="section-description">勾选成员，在同一行设置角色，可多选、可兼任。</p>
        <label><span className="sr-only">搜索成员</span><input type="search" placeholder="搜索姓名或账号" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <fieldset disabled={save.isPending || query.isError || !currentProject}>
          <div className="member-grid-heading" aria-hidden="true"><span>成员</span><span>项目角色</span></div>
          <div className="member-grid-list">
            {rows.map(({ id, existing }) => {
              const person = accounts.find((entry) => entry.id === id);
              const name = person?.displayName ?? '历史成员';
              const roles = draft?.changes[id] ?? project.members.find((member) => member.accountId === id)?.roles ?? [];
              const selected = existing || Object.hasOwn(draft?.changes ?? {}, id);
              const unavailable = !person || person.disabled || person.teamId !== project.teamId;
              return <div className={`member-grid-row${selected ? ' is-selected' : ''}`} key={id}>
                <label className="member-grid-person"><input type="checkbox" aria-label={`选择成员：${name}`} checked={selected} disabled={existing || unavailable} onChange={(event) => change(id, event.target.checked ? ['developer'] : null)} /><span><strong>{name}</strong><small>{person?.loginName}{existing ? ' · 已加入' : ''}{person?.disabled ? ' · 已停用' : ''}</small></span></label>
                <div className="member-grid-roles" role="group" aria-label={`${name}的项目角色`}>
                  {projectRoleSchema.options.map((role) => <label key={role}><input type="checkbox" aria-label={`${name}：${roleLabels[role]}`} checked={roles.includes(role)} disabled={!selected || unavailable} onChange={(event) => change(id, event.target.checked ? [...roles, role] : roles.filter((entry) => entry !== role))} />{roleLabels[role]}</label>)}
                  {selected && !roles.length && <small className="form-error">至少选择一个角色</small>}
                </div>
              </div>;
            })}
            {!rows.length && <p className="org-empty">没有匹配的成员。</p>}
          </div>
          {invalid && <p role="alert" className="form-error">请为已选择的成员设置至少一个角色。</p>}
          {save.error && <div role="alert" className="form-error"><p>{save.error.message} 选择已保留，请核对后重试。</p><button type="button" onClick={() => { setDraft(null); save.reset(); void query.refetch(); }}>放弃修改并重新加载</button></div>}
          <div className="member-grid-footer"><span>已加入 {project.members.length} 人{additions.length > 0 ? ` · 新增 ${additions.length} 人` : ''}{changes.length > additions.length ? ` · 修改 ${changes.length - additions.length} 人` : ''}</span><div className="org-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={!changes.length || invalid}>{save.isPending ? '正在保存…' : '保存设置'}</button></div></div>
        </fieldset>
        <p className="project-member-footnote">已有成员移出请到<Link to="/management">归档与交接</Link>处理。</p>
      </form>}
    </div>
  </Dialog>;
}
