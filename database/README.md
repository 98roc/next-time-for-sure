# 数据库脚本

> 初始化 SQL 保留 V1 历史快照；应用默认注册 22 项迁移，含 3 项 V2 增量结构。业务转换与旧表移除单独执行，普通迁移不会自动完成 V2 切换。边界见[迁移准备](../docs/development/V2.0迁移与研发准备.md)。

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

导入该历史快照后，当前应用会补执行 3 项 V2 结构迁移；再次执行应报告 `Applied migrations: 0`、`Pending migrations: false`，并通过实际中文注释检查。这只建立新结构，不转换历史业务。

## V2 隔离转换与恢复演练

先构建 API，再执行下面的演练命令。`--config` 指定只读来源连接配置；所有写入发生在脚本新建的临时 MySQL 5.7 实例。来源完整备份及摘要保存在被忽略的 `.cache/v2-rehearsal/`，其中备份包含敏感数据，不得提交或分发。

```powershell
.\scripts\pnpm.ps1 --filter @ntfs/api build
.\scripts\pnpm.ps1 exec node scripts/v2-rehearsal.mjs --config .env.local --mysql-bin E:\path\mysql-5.7\bin --decisions .cache/v2-inventory/approved-supplements.local.json
```

决策文件须包含实际操作者 `actorId` 与逐条批准的 `supplements`：`sourceTable`、`sourceId`、原创建日 `createdOn`、区间起日 `startOn`。未经批准的缺区间记录会中止转换。省略 `--decisions` 只演练结构和恢复，不验证业务转换。

转换入口在 `apps/api/src/database/v2-transition/`：稳定来源映射、历史与文字提取、事务回滚、源与目标摘要核对、真实 HTTP 回读。演练随后显式登记备份，执行独立的 `V2RetireLegacy1792281600000`，再恢复完整备份并核对每张表的结构和全部行摘要。普通 `db:migrate` 不注册此删除迁移；中断切换的基线就绪检查会返回 503。

该脚本不能直接对生产写入。正式切换仍须停写、重新盘点和备份，审核最新异常、执行人及恢复材料，再按授权执行转换、回读与独立切换。MySQL DDL 不支持整体回滚，恢复必须使用完整备份及匹配版本的应用。当前演练证据见[V2.0 实施记录](../docs/development/V2.0实施记录.md)。

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
