/** 校验迁移集合完整且无重复；切换迁移可在后续日常增量之前执行，不依赖写入记录顺序。 */
export function migrationsCurrent(applied: string[], required: string[], retired: boolean): boolean {
  const expected = new Set(retired ? [...required, 'V2RetireLegacy1792281600000'] : required);
  return applied.length === expected.size && new Set(applied).size === applied.length && applied.every((name) => expected.has(name));
}
