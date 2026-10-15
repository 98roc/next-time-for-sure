import { useState } from 'react';
import { personalStatusLabels } from '@ntfs/contracts';
import type { PersonalItem, PersonalSnapshot, PersonalStatus } from '@ntfs/contracts';
import type { PersonalSend } from './personal-forms';

/** 唯一分类一步流转，多个分类就近选择；移动菜单同时提供键盘和触屏替代操作。 */
export function PersonalAction({ item, categories, pending, send, status, label, className = '' }: { item: PersonalItem; categories: PersonalSnapshot['categories']; pending: boolean; send: PersonalSend; status?: PersonalStatus; label: string; className?: string }) {
  const [choosing, setChoosing] = useState(false);
  const targets = categories.filter((category) => (!status || category.status === status) && (status || category.id !== item.categoryId));
  function move(category: PersonalSnapshot['categories'][number]) {
    const base = { itemId: item.id, version: item.version, categoryId: category.id };
    send(status === 'in_progress' ? { ...base, action: 'start_personal' } : status === 'completed' ? { ...base, action: 'complete_personal' } : { ...base, action: 'move_personal', position: 1000000 }, () => setChoosing(false));
  }
  return <div className="personal-action"><button className={className} disabled={pending} aria-expanded={choosing} onClick={() => { const target = targets[0]; if (status && targets.length === 1 && target) move(target); else setChoosing(!choosing); }}>{label}</button>
    {choosing && <div className="personal-action-menu"><div className="personal-menu-heading"><span>移至{status ? personalStatusLabels[status] : '分类'}</span><button aria-label="取消选择分类" onClick={() => setChoosing(false)}>×</button></div>{targets.map((category) => <button key={category.id} disabled={pending} onClick={() => move(category)}>{category.name}{!status && category.name !== personalStatusLabels[category.status] && <small>{personalStatusLabels[category.status]}</small>}</button>)}</div>}
  </div>;
}
