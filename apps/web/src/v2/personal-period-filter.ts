import { useState } from 'react';
import type { V2Category, V2Task } from '@ntfs/contracts';
import { createOperationId } from '../identity/operation-id';
import { useWorkspace } from './workspace';

/** 仅持久化分类开关；周期选择留在页面内，默认使用包含上海当天的实际区间。 */
export function usePersonalPeriodFilter() {
  const { data, run } = useWorkspace();
  const [selections, setSelections] = useState<Record<string, string>>({});
  const current = data.periods.find((period) => period.startOn <= data.today && period.endOn >= data.today)?.id ?? 'all';
  const taskIdsByPeriod = new Map<string, Set<string>>();
  for (const row of data.arrangements) {
    const ids = taskIdsByPeriod.get(row.periodId) ?? new Set<string>();
    ids.add(row.taskId);
    taskIdsByPeriod.set(row.periodId, ids);
  }

  function periodFor(category: V2Category) {
    if (category.status !== 'not_started' || !data.categoryPeriodFilters.includes(category.id)) return null;
    const selected = selections[category.id];
    return selected && (selected === 'all' || data.periods.some((period) => period.id === selected)) ? selected : current;
  }

  function includes(task: V2Task, periodId: string | null) {
    return periodId === null || periodId === 'all' || task.kind === 'private' || Boolean(taskIdsByPeriod.get(periodId)?.has(task.id));
  }

  async function toggle(category: V2Category) {
    await run('personal-settings', {
      action: 'set_category_period_filter', operationId: createOperationId(),
      categoryId: category.id, version: category.version, enabled: !data.categoryPeriodFilters.includes(category.id),
    });
    setSelections((values) => {
      const next = { ...values };
      delete next[category.id];
      return next;
    });
  }

  function select(categoryId: string, periodId: string) {
    setSelections((values) => ({ ...values, [categoryId]: periodId }));
  }

  return { periodFor, includes, toggle, select };
}
