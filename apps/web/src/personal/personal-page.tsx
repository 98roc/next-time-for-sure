import { Dialog } from '../layout/dialog';
import { ManageLink } from './manage-link';
import { PersonalLifecycle } from '../lifecycle/personal-lifecycle';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { personalCommandSchema } from '@ntfs/contracts';
import type { PersonalCommand, PersonalItem, PersonalSnapshot, Identity } from '@ntfs/contracts';
import { currentIdentity } from '../identity/api';
import { organizationSnapshot } from '../organization/api';
import { assignmentSnapshot } from '../work/assignments-api';
import { personalCommand, personalSnapshot } from './api';
import { PersonalCard } from './personal-card';
import '../organization/organization.css';
import '../work/work.css';
import './personal.css';

/** 本人空间与可见工作分开显示，私人事项始终由服务端隔离。 */
export function PersonalPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: currentIdentity, retry: false });
  const [dragged, setDragged] = useState<PersonalItem | null>(null);
  const [dropCategory, setDropCategory] = useState<string | null>(null);
  const [scope, setScope] = useState<'mine' | 'visible'>('mine');
  const ready = Boolean(identity.data && !identity.data.mustChangePassword);
  const state = useQuery({ queryKey: ['personal', identity.data?.id, scope], queryFn: () => personalSnapshot(scope), enabled: ready, retry: false });
  const organization = useQuery({ queryKey: ['organization', identity.data?.id], queryFn: organizationSnapshot, enabled: ready, retry: false });
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [kind, setKind] = useState<'work' | 'private'>('work');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [revision, setRevision] = useState(0);
  const operation = useRef<{ content: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: (command: PersonalCommand) => { if (!identity.data) throw new Error('请先登录。'); return personalCommand(command, identity.data.csrfToken); }, onSuccess: async () => { operation.current = null; setNotice('已保存。'); setCreating(false); setRevision((value) => value + 1); await Promise.all([client.invalidateQueries({ queryKey: ['personal'] }), client.invalidateQueries({ queryKey: ['assignments'] }), client.invalidateQueries({ queryKey: ['work'] })]); } });
  function send(input: unknown) {
    const parsed = personalCommandSchema.safeParse(input);
    if (!parsed.success) { setError('请检查标题、检查项及日期；归属周须为周一日期。'); return; }
    const command = parsed.data;
    if ('operationId' in command) { const content = JSON.stringify({ ...command, operationId: '' }); if (operation.current?.content !== content) operation.current = { content, id: crypto.randomUUID() }; command.operationId = operation.current.id; }
    setError(''); setNotice(''); save.mutate(command);
  }
  const data = state.isError ? undefined : state.data;
  function insert(item: PersonalItem, categoryId: string | null, beforeId: string | null) {
    if (!data || save.isPending || item.id === beforeId) return;
    send({ action: 'insert_personal', itemId: item.id, version: item.version, categoryId, beforeId, order: data.items.filter((entry) => entry.ownerId === identity.data?.id && entry.categoryId === categoryId && entry.id !== item.id).map(({ id, version }) => ({ id, version })) });
    setDragged(null); setDropCategory(null);
  }
  return <main className="org-layout"><header className="org-header"><div><h1>我的工作</h1><p className="subtitle">安排自己的工作，记录每一步进展。</p></div><div className="assignment-actions"><button onClick={() => setManaging(true)}>管理分类</button><button className="primary-button" onClick={() => setCreating(true)}>＋ 新建事项</button></div></header>
    {identity.isError ? <p role="alert">身份读取失败，请重试。</p> : identity.isPending ? <p role="status">正在检查身份…</p> : !ready ? <p>请先<a href="/account">登录并完成改密</a>。</p> : <>
      <div className="org-feedback"><label>查看范围<select value={scope} onChange={(event) => setScope(event.target.value === 'visible' ? 'visible' : 'mine')}><option value="mine">我的事项</option><option value="visible">我有权查看的工作与本人事项</option></select></label><button disabled={state.isFetching || save.isPending} onClick={() => { void state.refetch(); }}>刷新</button>{notice && <span role="status">{notice}</span>}</div>
      {(error || save.isError || state.isError) && <p role="alert" className="form-error">{error || save.error?.message || state.error?.message} 冲突时请刷新，核对后重新保存。</p>}{state.isPending && <p role="status">正在加载个人空间…</p>}
      {organization.isError && <p role="alert">项目目录加载失败：{organization.error.message} <button onClick={() => { void organization.refetch(); }}>重试项目目录</button></p>}
      {data && identity.data && <><>{creating && <Dialog title="新建事项" onClose={() => setCreating(false)} busy={save.isPending}><form key={`new:${revision}`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'create_personal', kind, projectId: kind === 'work' ? String(form.get('projectId')) : null, assignmentId: null, title: String(form.get('title')), description: String(form.get('description')), acceptance: String(form.get('acceptance')), categoryId: String(form.get('categoryId')) || null, operationId: crypto.randomUUID() }); }}><fieldset disabled={save.isPending}><label>类型<select value={kind} onChange={(event) => setKind(event.target.value === 'private' ? 'private' : 'work')}><option value="work">工作事项</option><option value="private">私人事项（仅本人可见）</option></select></label>{kind === 'work' && <label>项目<select name="projectId" required><option value="">请选择项目</option>{organization.data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}<label>标题<input name="title" required maxLength={200} /></label><details><summary>补充内容（选填）</summary><label>说明（选填）<textarea name="description" maxLength={20000} /></label><label>完成标准（选填）<textarea name="acceptance" maxLength={20000} /></label></details><label>分类<select name="categoryId"><option value="">未分类</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><button className="primary-button">创建事项</button></fieldset></form>{(error || save.error) && <p role="alert" className="form-error">{error || save.error?.message}</p>}</Dialog>}{managing && <Dialog title="管理分类" onClose={() => setManaging(false)} busy={save.isPending}>
        <form key={`category:${revision}`} onSubmit={(event) => { event.preventDefault(); send({ action: 'create_category', name: String(new FormData(event.currentTarget).get('name')), operationId: crypto.randomUUID() }); }}><label>新分类名称<input name="name" required maxLength={200} /></label><button disabled={save.isPending}>创建分类</button></form>{data.categories.map((category) => <form key={`${category.id}:${category.version}`} onSubmit={(event) => { event.preventDefault(); send({ action: 'rename_category', categoryId: category.id, version: category.version, name: String(new FormData(event.currentTarget).get('name')) }); }}><label>分类名称<input name="name" required defaultValue={category.name} maxLength={200} /></label><button disabled={save.isPending}>改名</button><button type="button" disabled={save.isPending} onClick={() => send({ action: 'delete_category', categoryId: category.id, version: category.version })}>移除此分类，事项保留至未分类</button></form>)}{(error || save.error) && <p role="alert" className="form-error">{error || save.error?.message}</p>}</Dialog>}</>
        <div className="personal-columns">{[{ id: '', name: '未分类' }, ...data.categories].map((category) => <section key={category.id} className={dropCategory === category.id ? 'personal-drop-active' : ''} onDragOver={(event) => { if (dragged && !save.isPending) { event.preventDefault(); setDropCategory(category.id); } }} onDrop={(event) => { event.preventDefault(); if (dragged && !save.isPending) { insert(dragged, category.id || null, null); } setDragged(null); setDropCategory(null); }}><h2>{category.name}</h2>{dropCategory === category.id && <p className="personal-drop-placeholder">松开移至分类末尾，不改变执行状态</p>}{data.items.filter((item) => item.ownerId === identity.data?.id && (item.categoryId ?? '') === category.id).map((item) => <div key={item.id} onDragOver={(event) => { if (dragged && dragged.id !== item.id && !save.isPending) { event.preventDefault(); event.stopPropagation(); setDropCategory(item.id); } }} onDrop={(event) => { if (dragged) { event.preventDefault(); event.stopPropagation(); insert(dragged, item.categoryId, item.id); } }}>{dropCategory === item.id && <p className="personal-drop-placeholder">插入此事项之前</p>}<button className="personal-drag-handle" disabled={save.isPending} draggable={!save.isPending} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDragged(item); }} onDragEnd={() => { setDragged(null); setDropCategory(null); }} title="拖动调整分类或顺序" aria-label={`拖动分类：${item.title}`}>↕</button><Item item={item} identity={identity.data} data={data} pending={save.isPending} send={send} error={error || save.error?.message} /></div>)}</section>)}</div>
        {scope === 'visible' && <section><h2>可见的团队工作（只读）</h2><div className="personal-visible">{data.items.filter((item) => item.ownerId !== identity.data?.id).map((item) => <Item key={item.id} item={item} identity={identity.data} data={data} pending={save.isPending} send={send} error={error || save.error?.message} />)}</div></section>}
      </>}
    </>}
  </main>;
}

/** 按事项项目加载本人可关联的分工；私人及他人事项不发起分工查询。 */
function Item({ item, identity, data, pending, send, error }: { item: PersonalItem; identity: Identity | null | undefined; data: PersonalSnapshot; pending: boolean; send: (input: unknown) => void; error: string | undefined }) {
  const own = item.ownerId === identity?.id;
  const assignments = useQuery({ queryKey: ['assignments', identity?.id, item.projectId], queryFn: () => assignmentSnapshot(item.projectId ?? ''), enabled: Boolean(own && item.projectId), retry: false });
  return <><PersonalCard item={item} own={own} data={data} assignments={assignments.data} pending={pending} send={send} feedback={error && <p role="alert" className="form-error">{error}</p>} management={<>{identity && <PersonalLifecycle item={item} identity={identity} />}{identity && item.kind === 'work' && <ManageLink item={item} identity={identity} pending={pending} send={send} />}</>} /></>;
}
