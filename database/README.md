# 数据库脚本

> 初始化 SQL 保留 V1 历史快照；应用迁移以当前注册列表为准，包含 V2 增量结构。业务转换与旧表移除单独执行，普通迁移不会自动完成 V2 切换。边界见[迁移准备](../docs/development/V2.0迁移与研发准备.md)。

当前支持 MySQL 5.7，字符集 `utf8mb4`，排序规则 `utf8mb4_unicode_ci`。连接配置、生产地址、管理员口令及数据备份不进入 Git。

## 选择执行方式

| 场景 | 入口 |
| --- | --- |
| Docker 首次部署与后续升级 | `scripts/deploy.ps1`，备份后执行应用迁移 |
| 本地开发迁移／检查 | `scripts/pnpm.ps1 db:migrate`／`db:status`，读取忽略的 `.env.local` |
| DBA 手工建立全新空库 | `sql/v1.0.0-initialize.sql`，与首次迁移二选一 |
| 已建立数据库的只读检查 | `sql/verify.sql`，不修改业务数据 |

权威增量迁移在 [apps/api/src/database/migrations](../apps/api/src/database/migrations)，执行顺序在 [data-source.ts](../apps/api/src/database/data-source.ts)。升级时只新增迁移，不修改已经执行过的迁移，不通过重复导入初始化 SQL 升级。

## 手工初始化

`v1.0.0-initialize.sql` 是 1.0.0 发布的数据库基线，截至 `PersonalWorkflow1792022401000` 的 19 个迁移完成后的结构快照，包含表、字段中文注释、索引、外键和必要的系统种子数据（平台基线、默认角色权限、迁移记录）。不包含账号、密码哈希、会话、Token 或业务示例数据。

仅用于尚不存在 `next_time_for_sure` 库的环境。它有意不提供 `DROP DATABASE`、`DROP TABLE` 或 `CREATE DATABASE IF NOT EXISTS`，目标库存在即应停止。先核对目标并保留备份，不使用客户端的 `--force` 继续执行错误语句。MySQL DDL 无法整体事务回滚，失败时先检查实际状态，不能盲目重跑。

在安装 MySQL 客户端的 Bash 环境中执行（配置文件为权限 600 的私有 `[client]` 文件；不要把密码写在命令参数里）：

```bash
mysql --defaults-extra-file=/absolute/private/mysql.cnf --default-character-set=utf8mb4 < database/sql/v1.0.0-initialize.sql
mysql --defaults-extra-file=/absolute/private/mysql.cnf --default-character-set=utf8mb4 < database/sql/verify.sql
```

PowerShell 5.1 不使用上述 `<` 重定向语法；项目的 PowerShell 迁移／部署入口会直接调用应用迁移，无需手工导入。SQL 文件保持 UTF-8，不经 PowerShell 默认编码管道转换。

导入该历史快照后，当前应用会补执行后续 V2 结构迁移；再次执行应报告 `Applied migrations: 0`、`Pending migrations: false`，并通过实际中文注释检查。这只建立新结构，不转换历史业务。

## V2 隔离转换与恢复演练

先构建 API，再执行下面的演练命令。`--config` 指定只读来源连接配置；所有写入发生在脚本新建的临时 MySQL 5.7 实例。来源完整备份及摘要保存在被忽略的 `.cache/v2-rehearsal/`，其中备份包含敏感数据，不得提交或分发。

```powershell
.\scripts\pnpm.ps1 --filter @ntfs/api build
.\scripts\pnpm.ps1 exec node scripts/v2-rehearsal.mjs --config .env.local --mysql-bin E:\path\mysql-5.7\bin --decisions .cache/v2-inventory/approved-supplements.local.json
```

决策文件须包含实际操作者 `actorId` 与逐条批准的 `supplements`：`sourceTable`、`sourceId`、原创建日 `createdOn`、区间起日 `startOn`。未经批准的缺区间记录会中止转换。省略 `--decisions` 只演练结构和恢复，不验证业务转换。

转换入口在 `apps/api/src/database/v2-transition/`：稳定来源映射、历史与文字提取、事务回滚、源与目标摘要核对、真实 HTTP 回读。演练随后显式登记备份，执行独立的 `V2RetireLegacy1792281600000`，再恢复完整备份并核对每张表的结构和全部行摘要。普通 `db:migrate` 不注册此删除迁移；中断切换的基线就绪检查会返回 503。

该脚本不能直接对生产写入。正式切换仍须停写、重新盘点和备份，审核最新异常、执行人及恢复材料，再按授权执行转换、回读与独立切换。MySQL DDL 不支持整体回滚，恢复必须使用完整备份及匹配版本的应用。当前演练证据见[V2.0 实施记录](../docs/development/V2.0实施记录.md)。

正式入口已接入 [Docker 部署](../docs/development/Docker部署.md) 的 `-V2Cutover` 参数，生产于 2026-10-18 完成切换。切换后的日常发布不再传该参数。`scripts/verify-v1-backup.mjs` 可将停写时生成的 gzip 备份恢复到独立临时 MySQL 并与审核来源核对；本次实际生产备份已通过该验证。备份内的旧认证和业务数据仅作恢复材料，不开放旧业务查询。

## 初始化管理员

SQL 不创建管理员，也不提供公共默认密码。生产环境只初始化 `admin`：在忽略的 `.deploy.production.local` 中设置 `INITIAL_ADMIN_PASSWORD`，部署成功后执行：

```powershell
.\scripts\deploy.ps1 -Action InitAdmin
```

已有账号时程序拒绝再次初始化，不覆盖账号或重置密码。密码通过标准输入传递、加盐派生后入库，首次登录要求改密。详见 [Docker 部署](../docs/development/Docker部署.md)。

## 快照维护

后续若需要更新空库快照，应在独立的空数据库中完整执行版本化迁移，导出纯结构及上述三张系统表；确认所有业务表为空，禁止直接导出有业务数据的生产库。保留快照对应的最终迁移名称和日期，并验证空库导入、迁移幂等、中文注释及就绪接口。运行时备份只能留在受控环境，不加入本目录。

## 1.0.0 验证记录

2026-10-16 在独立的 MySQL 5.7.44 临时容器中执行全部 19 个迁移、导出空库快照、重新建库导入 SQL，再执行应用迁移，结果为新增 0 个、无待执行迁移，中文注释 272/272。导入后账号数为 0；单独通过标准输入初始化后只有一个 `admin` 超管，再次初始化被拒绝。临时容器和数据卷已清理，没有改动开发库或生产库。


## 2026-10-19 排序增量

`1792368000000-v2-sorting` 为共享排序及个人分类添加手动标记，保留已有顺序；`1792368001000-project-created-at` 为项目添加可空创建时间并仅从创建审计还原。新项目由创建入口写入真实 UTC 时间，旧项目缺证据时为空，不使用迁移时间补造。

本地 MySQL 5.7.35 已执行两条迁移并核验 405/405 中文表字段注释；生产于 2026-10-19 备份后执行成功，累计 25 项迁移、192/192 中文注释，重发时新增迁移为 0、无待执行项。生产已删除旧业务表，因此注释总数与本地不同。就绪检查按迁移名称集合核验，兼容 V2 切换后追加普通迁移，同时拒绝缺失、未知或重复记录。1.0.0 空库快照未改写，导入后仍须执行全部后续版本化迁移。发布故障修复、备份及未验证项见[V2.0 实施记录](../docs/development/V2.0实施记录.md#排序增量项目周计划与我的工作2026-10-19)。

## 首页标语列表升级（2026-10-19）

`TeamMessages1792368002000` 将 `v2_team_settings.message` 的非空原文转换为 `messages_json` 第一项，空白转换为空数组，再移除旧列；新列有中文注释。迁移可在 DDL 中断后重跑，已转换的列表不覆盖，不支持退回单条。

升级需先备份并停止旧 API 写入，执行迁移，再启动同版本 API、网页及 MCP；旧客户端的 `teamMessage` / `set_message` 已替换为 `teamMessages` / `set_messages`（参数 `messages`）。普通迁移不修改生产配置，本次执行环境及证据见实施记录。

## 任务投入与完成结果（2026-10-22）

`TaskEffort1792627200000` 为 `v2_tasks` 增加可空的 `actual_days DECIMAL(6,2)` 与 `ai_contribution VARCHAR(10)`，均含中文注释；不回填历史值，周期预计投入仍保存在 `v2_arrangements`。任务结果与版本、操作事件同事务写入。

本地 `127.0.0.1:3306/next_time_for_sure` 的 MySQL 5.7.35 已执行，待执行迁移为 0，中文表字段注释 413/413。生产于2026-10-22停写、备份后执行1项迁移，随后重发显示新增0项、无待执行迁移、中文注释200/200；独立回读确认两个字段及中文注释、迁移仅登记一次。旧客户端完成项目任务时未传实际投入会被新 API 拒绝，网页及桌面加载的服务端页面需刷新，独立 MCP 客户端需更新代码并重启。1.0.0 空库快照保持不变，导入后继续执行增量迁移。

## 私人子任务与日报（2026-10-22）

`PersonalSubtasksDaily1792627201000` 新增 `v2_personal_preferences`（本人完成查看模式和日报项目顺序）、`v2_personal_subtasks`（本人主任务清单）、`v2_personal_subtask_events`（不可变清单快照）及 `v2_daily_reports`（本人按日文字稿）四张表。主任务事件新增项目名快照，不改写旧事件，不回填私人历史。

本地 MySQL 5.7.35 已执行，中文表字段注释437/437，无待执行项；生产尚未执行。发布时先备份，再执行迁移，API、网页和独立 MCP 使用同版本契约。迁移不支持自动删除历史的 down；中断后可重跑，恢复使用核验过的备份。

## 里程碑取消人员归属（2026-10-23）

新增迁移 `RetireMilestoneOwner1792720800000`：将 `v2_milestones.owner_id` 改为可空并更新中文注释，保留原有历史值；新建里程碑不再写入，该列不再参与当前契约、权限和成员移出检查。迁移可重复执行，不回填历史人员。新版本上线前须执行迁移；回退旧版本须使用迁移前备份，不能替无归属的新目标虚构负责人。

预计投入必填由网页/API/Agent 共用写入契约校验；现存 `planned_days` 空值与历史记录保持原样，不伪造估算或零投入。

## 周报项目顺序跨周期共享（2026-10-23）

`WeeklyProjectOrder1792713601000` 将周报项目组顺序承接到团队唯一的 `weekly:projects` 作用域，任务仍按项目和区间排序。优先采用上海当前周期已保存的顺序；当前周期没有记录时，采用日期最近的已保存周期，极早版本以 `projects` 键兜底。旧表没有修改时间，不能将这个选择称为“最后一次排序”。保留旧顺序记录，重复执行不会覆盖新作用域；新版本号高于旧周期版本，拒绝升级前的过期排序请求。

本地 `127.0.0.1:3306/next_time_for_sure`、MySQL 5.7.35 已执行1项迁移，执行后无待执行项，中文表字段注释437/437。生产尚未执行；部署需按既有流程备份、停止旧API写入、执行迁移并更新API及网页。此迁移不新增表或字段，不改写手工周报正文。

## 周期工作与完成时间补录（2026-10-26）

`TaskPeriodWork1792972800000` 在当前安排及安排历史新增可选文本 `work_note`、系统顺延来源 `carried_from_period_id`；历史新增 `voided`，表示补录完成时间撤销的系统追加，不物理删除审计。任务事件和安排历史的 `actor_id` 改为可空，系统操作不伪装成执行人。新增字段均有中文注释，旧安排的工作内容为空，来源为空；不倒造已有数据的系统顺延来源。

本地 `127.0.0.1:3306/next_time_for_sure`、MySQL 5.7.35 已执行1项迁移，无待执行项，中文表字段注释442/442。生产尚未执行本迁移。部署前须备份、停止旧API写入、执行迁移，再启动同版本网页/API；启动后的自动顺延会实际新增当前周期安排。DDL中断可重跑，不支持丢弃业务历史的down，回退使用备份。完成时间沿用已有 `completed_at`；纠正事件保留真实提交时刻，业务归属读取实际完成时间。

## 实际开始时间（2026-10-26）

`TaskStartedAt1792987200000` 为 `v2_tasks` 新增可空 `started_at DATETIME(3)`，按 UTC 保存本轮实际开始时间并设置中文注释。旧任务及旧事件不回填猜测值；新的状态变更、完成及修正事件保留对应起止快照。输入和展示规则见[项目设计](../docs/design/V2.0项目设计.md#投入与完成结果)。

本地 `127.0.0.1:3306/next_time_for_sure`、MySQL 5.7.35 已执行该迁移，无待执行项，实际中文注释443/443。真实 API 回归已回读该字段并核验空值、历史快照和版本冲突。生产尚未执行；发布须备份并先迁移再启动新版 API，不支持丢弃已有数据的 down。
