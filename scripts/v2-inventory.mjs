import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const { createConnection } = requireApi('mysql2/promise');
const { parse } = requireApi('dotenv');

/** 只清点本项目数据库；使用数据库级只读一致性快照，不调用有结转副作用的 V1 API。 */
async function inventory() {
  const { values } = parseArgs({ options: { config: { type: 'string', default: '.env.local' }, output: { type: 'string' } }, strict: true });
  const config = parse(await readFile(resolve(root, values.config)));
  if (config.DB_DATABASE !== 'next_time_for_sure') throw new Error('TARGET_DATABASE_REJECTED');
  if (!config.DB_HOST || !config.DB_USERNAME || !config.DB_PASSWORD) throw new Error('CONFIGURATION_INCOMPLETE');
  const connection = await createConnection({ host: config.DB_HOST, port: Number(config.DB_PORT || 3306), user: config.DB_USERNAME, password: config.DB_PASSWORD, database: config.DB_DATABASE, connectTimeout: 10000, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  try {
    // 不把密码、账号摘要、会话、Token 或业务自由文本读入盘点结果。
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('SET SESSION MAX_EXECUTION_TIME=15000');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const query = async (sql) => (await connection.query(sql))[0];
    const target = await query('SELECT DATABASE() AS database_name, VERSION() AS mysql_version, @@hostname AS server_name, UTC_TIMESTAMP(3) AS inspected_at');
    const tables = await query("SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    const columns = await query('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
    const names = new Set(tables.map((table) => table.name));
    const counts = [];
    for (const table of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(table.name)) throw new Error('UNEXPECTED_TABLE_IDENTIFIER');
      const [row] = await query(`SELECT COUNT(*) AS count FROM \`${table.name}\``);
      counts.push({ table: table.name, count: Number(row.count) });
    }
    // 异常只输出旧标识；迁移前据此逐条定位，不猜测执行人、时间或人工文字的取舍。
    const checks = [
      ['multiple_executors', ['task_assignments'], "SELECT task_id AS id, COUNT(*) AS count FROM task_assignments WHERE status NOT IN ('exited','transferred') GROUP BY task_id HAVING COUNT(*)>1"],
      ['multiple_linked_items', ['personal_items'], 'SELECT assignment_id AS id, COUNT(*) AS count FROM personal_items WHERE assignment_id IS NOT NULL GROUP BY assignment_id HAVING COUNT(*)>1'],
      ['tasks_without_executor', ['team_tasks','task_assignments'], "SELECT t.id FROM team_tasks t WHERE NOT EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id=t.id AND a.status NOT IN ('exited','transferred'))"],
      ['assignments_without_period', ['task_assignments','weekly_arrangements'], "SELECT a.id, a.task_id FROM task_assignments a WHERE a.status NOT IN ('exited','transferred') AND NOT EXISTS (SELECT 1 FROM weekly_arrangements w WHERE w.assignment_id=a.id)"],
      ['parent_child_tasks', ['team_tasks'], 'SELECT id,parent_id FROM team_tasks WHERE parent_id IS NOT NULL'],
      ['cancelled_tasks', ['team_tasks'], "SELECT id FROM team_tasks WHERE status='cancelled'"],
      ['archived_projects', ['projects'], 'SELECT id FROM projects WHERE archived<>0'],
      ['former_executors', ['task_assignments','team_tasks','project_members'], "SELECT a.id,a.task_id,a.account_id FROM task_assignments a JOIN team_tasks t ON t.id=a.task_id LEFT JOIN project_members m ON m.project_id=t.project_id AND m.account_id=a.account_id WHERE m.account_id IS NULL AND a.status NOT IN ('exited','transferred')"],
      ['milestone_requires_review', ['project_milestones','team_tasks','task_assignments'], "SELECT DISTINCT m.id FROM project_milestones m JOIN team_tasks t ON t.milestone_id=m.id WHERE m.status='completed' AND (t.status<>'completed' OR EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id=t.id AND a.status NOT IN ('completed','exited','transferred')))"],
      ['publication_versions', ['weekly_publications'], 'SELECT team_id,week,kind,COUNT(*) AS count FROM weekly_publications GROUP BY team_id,week,kind'],
      ['personal_work_without_assignment', ['personal_items'], "SELECT id,project_id FROM personal_items WHERE kind='work' AND assignment_id IS NULL"],
      ['duplicate_category_names', ['personal_categories'], 'SELECT owner_id,COUNT(*) AS count FROM personal_categories GROUP BY owner_id,name HAVING COUNT(*)>1'],
      ['unfinished_without_project_member', ['personal_items','project_members'], "SELECT p.id,p.project_id FROM personal_items p LEFT JOIN project_members m ON m.project_id=p.project_id AND m.account_id=p.owner_id WHERE p.kind='work' AND p.status<>'completed' AND m.account_id IS NULL"],
    ];
    const findings = {};
    for (const [key, required, sql] of checks) {
      if (!required.every((name) => names.has(name))) { findings[key] = { skipped: 'SOURCE_TABLE_MISSING' }; continue; }
      const rows = await query(sql);
      findings[key] = { count: rows.length, records: rows };
    }
    const migrations = names.has('schema_migrations') ? await query('SELECT name FROM schema_migrations ORDER BY id') : [];
    const report = { target: { configuredHost: config.DB_HOST, configuredPort: Number(config.DB_PORT || 3306), ...target[0] }, readOnly: true, counts, findings, migrations, tables, columns };
    await connection.rollback();
    if (values.output) {
      const output = resolve(root, values.output);
      const withinCache = relative(resolve(root, '.cache'), output);
      if (isAbsolute(withinCache) || withinCache.startsWith('..') || !withinCache) throw new Error('OUTPUT_MUST_BE_IN_IGNORED_CACHE');
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(JSON.stringify({ target: report.target, readOnly: true, counts, findings: Object.fromEntries(Object.entries(findings).map(([key, value]) => [key, 'count' in value ? value.count : value.skipped])), missingChineseComments: [...tables.filter((t) => !/[\u4e00-\u9fff]/u.test(t.comment)), ...columns.filter((c) => !/[\u4e00-\u9fff]/u.test(c.comment))].length }, null, 2));
  } finally { await connection.end(); }
}

await inventory().catch((error) => {
  // 连接异常可能带有密码或 SQL，终端只输出受限代码。
  console.error(`V2 inventory failed: ${typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'CHECK_CONFIGURATION_AND_SCHEMA'}`);
  process.exitCode = 1;
});
