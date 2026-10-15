import { useState } from 'react';
import type { PersonalSnapshot } from '@ntfs/contracts';

/** 分类管理采用逐行编辑；移除前说明事项去向，避免误把分类删除当作事项删除。 */
export function CategoryManager({ categories, pending, revision, send }: { categories: PersonalSnapshot['categories']; pending: boolean; revision: number; send: (input: unknown) => void }) {
  const [removing, setRemoving] = useState('');
  return <div className="category-manager">
    <form key={revision} className="category-create" onSubmit={(event) => { event.preventDefault(); send({ action: 'create_category', name: String(new FormData(event.currentTarget).get('name')), operationId: crypto.randomUUID() }); }}><label>新增分类<input name="name" required maxLength={200} placeholder="例如：今天优先、待跟进" /></label><button className="primary-button" disabled={pending}>添加</button></form>
    <div className="section-heading"><h3>已有分类</h3><span className="detail-meta">{categories.length} 个</span></div>
    {!categories.length && <p className="subtitle">还没有分类。添加后，可拖动事项进行整理。</p>}
    {categories.map((category) => <div className="category-row" key={`${category.id}:${category.version}`}><form onSubmit={(event) => { event.preventDefault(); send({ action: 'rename_category', categoryId: category.id, version: category.version, name: String(new FormData(event.currentTarget).get('name')) }); }}><label><span className="sr-only">分类名称：{category.name}</span><input name="name" required defaultValue={category.name} maxLength={200} /></label><button disabled={pending}>保存</button><button className="text-button danger-button" type="button" disabled={pending} onClick={() => setRemoving(category.id)}>移除</button></form>
      {removing === category.id && <div className="inline-notice"><p>移除“{category.name}”？其中的事项会移至未分类，内容和进展保留。</p><div className="org-actions"><button className="danger-button" disabled={pending} onClick={() => send({ action: 'delete_category', categoryId: category.id, version: category.version })}>确认移除</button><button disabled={pending} onClick={() => setRemoving('')}>取消</button></div></div>}
    </div>)}
    <p className="detail-meta">分类仅用于整理自己的事项，不改变工作状态。</p>
  </div>;
}
