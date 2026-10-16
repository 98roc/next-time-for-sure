import { createOperationId } from '../identity/operation-id';
import { useState } from 'react';
import { personalStatusLabels, personalStatusSchema } from '@ntfs/contracts';
import type { PersonalSnapshot } from '@ntfs/contracts';

/** 分类按状态分区；删除前选择同阶段去向，最后一列不可删除。 */
export function CategoryManager({ categories, pending, revision, send }: { categories: PersonalSnapshot['categories']; pending: boolean; revision: number; send: (input: unknown) => void }) {
  const [removing, setRemoving] = useState('');
  return <div className="category-manager">
    <p className="detail-meta">分类名称可以自定义。拖入分类时，事项会变成该分类对应的状态。</p>
    <form key={revision} className="category-create" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); send({ action: 'create_category', name: String(form.get('name')), status: String(form.get('status')), operationId: createOperationId() }); }}><label>分类名称<input name="name" required maxLength={200} placeholder="例如：正在开发、等待联调" /></label><label>对应状态<select name="status">{personalStatusSchema.options.map((status) => <option key={status} value={status}>{personalStatusLabels[status]}</option>)}</select></label><button className="primary-button" disabled={pending}>添加</button></form>
    {personalStatusSchema.options.map((status) => <section key={status}><h3>{personalStatusLabels[status]}</h3>{categories.filter((entry) => entry.status === status).map((category) => {
      const siblings = categories.filter((entry) => entry.status === status && entry.id !== category.id);
      return <div className="category-row" key={`${category.id}:${category.version}`}><form onSubmit={(event) => { event.preventDefault(); send({ action: 'rename_category', categoryId: category.id, version: category.version, name: String(new FormData(event.currentTarget).get('name')) }); }}><label><span className="sr-only">分类名称：{category.name}</span><input name="name" required defaultValue={category.name} maxLength={200} /></label><button disabled={pending}>保存</button><button className="text-button danger-button" type="button" disabled={pending || !siblings.length} title={!siblings.length ? '每种状态至少保留一个分类' : '移除分类，保留事项'} onClick={() => setRemoving(category.id)}>移除</button></form>
        {removing === category.id && <form className="category-removal" onSubmit={(event) => { event.preventDefault(); send({ action: 'delete_category', categoryId: category.id, version: category.version, targetCategoryId: String(new FormData(event.currentTarget).get('target')) }); }}><p>事项与进展保留，移至同状态的分类：</p><select name="target" required defaultValue={siblings.length === 1 ? siblings[0]?.id : ''}><option value="" disabled>选择去向</option>{siblings.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><button disabled={pending}>确认移除</button><button type="button" disabled={pending} onClick={() => setRemoving('')}>取消</button></form>}
      </div>;
    })}</section>)}
  </div>;
}
