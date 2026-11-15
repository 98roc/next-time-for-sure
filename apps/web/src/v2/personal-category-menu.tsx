import type { V2Category } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { CategoryForm, DeleteCategory } from './category-dialogs';
import { useModal } from './modal';
import { useMoreMenu } from './use-more-menu';
import { useWorkspace } from './workspace';
import type { useAction } from './controls';
import type { useCompletedFilter } from './personal-completed';

/** 分类菜单承载查看偏好及分类管理，选中操作后先收起菜单。 */
export function PersonalCategoryMenu({ category, busy, action, completed, periodFilterEnabled, onTogglePeriod }: {
  category: V2Category;
  busy: boolean;
  action: ReturnType<typeof useAction>;
  completed: ReturnType<typeof useCompletedFilter>;
  periodFilterEnabled: boolean;
  onTogglePeriod: () => Promise<void>;
}) {
  const { data, run } = useWorkspace();
  const modal = useModal();
  const menu = useMoreMenu();
  const last = data.categories.filter((row) => row.status === category.status).length === 1;

  function choose(work: () => void) {
    menu.closeAndFocus();
    work();
  }

  return <div className="mw-col-menu" data-open={menu.open} ref={menu.root} onBlur={menu.onBlur} onKeyDown={menu.onKeyDown}>
    <button ref={menu.trigger} type="button" className="mw-col-menu-trigger" aria-label={`${category.name}分类操作`} aria-expanded={menu.open} onClick={menu.toggle}>⋯</button>
    {menu.open && <div className="mw-col-menu-panel">
      {category.status === 'not_started' && <>
        <button type="button" disabled={busy} aria-pressed={periodFilterEnabled} className={periodFilterEnabled ? 'is-selected' : undefined}
          onClick={() => choose(() => { void action.act(onTogglePeriod); })}>
          按周期筛选{periodFilterEnabled && <span aria-hidden="true">✓</span>}
        </button>
        <hr />
      </>}
      {category.status === 'completed' && <>
        <small>完成记录查看方式</small>
        <button disabled={busy} className={completed.mode === 'day' ? 'is-selected' : undefined} onClick={() => choose(() => completed.changeMode('day'))}>按日期{completed.mode === 'day' ? ' ✓' : ''}</button>
        <button disabled={busy} className={completed.mode === 'period' ? 'is-selected' : undefined} onClick={() => choose(() => completed.changeMode('period'))}>按日期区间{completed.mode === 'period' ? ' ✓' : ''}</button>
        <hr />
      </>}
      <button disabled={busy} onClick={() => choose(() => modal.open(<CategoryForm category={category} />))}>修改名称</button>
      <button disabled={category.isDefault || busy} onClick={() => choose(() => {
        void action.act(() => run('personal', { action: 'default_category', operationId: createOperationId(), version: data.personalVersion, categoryId: category.id }));
      })}>设为默认</button>
      <button disabled={last || busy} onClick={() => choose(() => modal.open(<DeleteCategory category={category} />))}>删除分类</button>
      {last && <small>每种状态至少保留一个分类</small>}
    </div>}
  </div>;
}
