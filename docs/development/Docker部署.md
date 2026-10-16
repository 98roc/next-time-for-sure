# Docker 生产部署

## 文件与职责

- `scripts/deploy.ps1`：Windows PowerShell 5.1 的统一入口，需要 Python 3.12+、本机 Linux Docker 引擎，以及项目 Node/pnpm 工具链。
- `deploy/production.env.example`：空白配置模板，不包含任何真实环境地址、账号、口令或目录。
- `.deploy.production.local`：本地私有生产配置，已被 Git 的 `*.local` 规则忽略。包含 SSH 和数据库连接，禁止提交或分享。
- `.deploy.production.notes.local`：本地环境检查记录，不进入仓库。
- `deploy/Dockerfile.api`、`deploy/Dockerfile.web`、`deploy/nginx.conf`：运行镜像和同源反向代理配置。

实际环境信息只填写在私有配置中。不要命名为 `.env.production.local`，避免 Vite 自动读取部署账号和服务器参数。开发环境继续使用原有 `.env.local`。

## 首次配置

复制模板并补齐所有空值：

```powershell
Copy-Item deploy/production.env.example .deploy.production.local
```

| 配置项 | 含义 |
| --- | --- |
| `DEPLOY_HOST`、`DEPLOY_SSH_PORT`、`DEPLOY_USER` | SSH 连接目标 |
| `DEPLOY_PASSWORD` | 可选 SSH 密码；留空时使用密钥或交互输入 |
| `INITIAL_ADMIN_PASSWORD` | 可选初始管理员密码，仅填写在本地私有配置；留空则随机生成 |
| `DEPLOY_PATH` | 服务器绝对目录，末级必须为 `next-time-for-sure`，不能包含 `..` |
| `HTTP_BIND`、`HTTP_PORT` | 网页入口绑定的服务器 IPv4 地址与空闲端口 |
| `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD` | 独立 MySQL 服务的连接参数 |
| `DB_DATABASE` | 固定为 `next_time_for_sure`，防止迁移误入其他业务库 |
| `API_HOST`、`API_PORT` | 固定为 `0.0.0.0`、`3100`；只在 Docker 网络内部可见 |
| `NODE_ENV` | 固定为 `production` |

文件为字面量 `KEY=value` 格式，不支持 shell 展开、行内注释或多行值；密码不添加额外引号。首次连接新主机时，先用 Windows OpenSSH 核验主机指纹并写入用户的 `known_hosts`，脚本拒绝未知或已变化的密钥。

本机 Docker Desktop 必须启动，选择 Linux 容器。SSH 账号需要 Docker 操作及部署目录写权限。服务器预置 Docker、Bash、`flock`、`curl`、`gzip`、`sha256sum`，以及 `docker.io/mysql:5.7.43` 客户端镜像。脚本不安装或升级系统 Docker。

## 环境准备与验证

在仓库根目录运行：

```powershell
.\scripts\deploy.ps1 -Action Prepare
.\scripts\deploy.ps1 -Action Check
```

`Prepare` 在本机获取官方 Node 24.21.0 Alpine、Nginx 1.30.6 Debian 镜像，打包上传并导入服务器；创建私有目录、写入首次配置，验证 Node、线程、加密、Nginx HTTP 服务和数据库连接。已有服务器配置不会被准备流程覆盖。它不创建业务库、运行迁移或发布业务服务。

Docker Hub 拉取失败时，脚本可通过本机 Python HTTPS/系统代理下载官方镜像，按 Linux amd64 清单校验压缩层与解压层 SHA256，再生成旧引擎也能读取的镜像归档。不开启不安全镜像仓库，不关闭 TLS 验证。

需要验证当前代码的实际镜像时运行：

```powershell
.\scripts\deploy.ps1 -Action Validate
```

这会编译当前工作目录中的 API 和网页，导出 API 生产依赖，构建、上传镜像，在服务器临时网络与随机回环端口运行，检查生产依赖、只读数据库连接、API 存活、Nginx 转发和 SPA 页面。结束时回收测试容器、网络和服务器测试镜像；不执行业务迁移。首次部署前 readiness 返回 503 是预期行为，不能据此声称业务已就绪。

## 一键部署

代码修改完成并确认当前工作目录可发布后运行：

```powershell
.\scripts\deploy.ps1
```

默认动作为 `Deploy`，**会发布当前工作目录，包括尚未提交的源码修改**。只打包 API 生产依赖、API 编译结果和网页产物，不发布 Electron 或 MCP 客户端，不上传开发配置或 SSH 凭据。

部署顺序：

1. 本机构建两个镜像，生成版本号，上传镜像归档与该版本私有配置；服务器验证归档 SHA256。
2. 检查端口、独立数据库目标和 Docker 所在磁盘的剩余空间，使用 `flock` 阻止并发切换。
3. 停止本项目容器的写入；如果业务库存在，先导出完整 SQL 备份并检查压缩文件和摘要。备份失败立即终止。
4. 运行应用的版本化迁移，首次部署创建专用库；应用 CLI 校验 MySQL 5.7、迁移锁及中文表字段注释。
5. 启动 API，等待数据库和迁移就绪；再启动 Nginx，验证主页与就绪接口，成功后记录当前版本。

API 不映射宿主机端口。两个容器使用独立网络，设置内存上限、日志轮转和 `unless-stopped` 重启策略；API 使用普通用户、移除 Linux capabilities。Nginx 保留浏览器原始 Host 和端口，以满足同源校验。

## 首次管理员

首次正式部署成功后单独执行：

```powershell
.\scripts\deploy.ps1 -Action InitAdmin
```

程序仅在无账号时创建 `admin` 超级管理员，已有账号时拒绝；不会创建演示账号或业务数据。可在本地 `.deploy.production.local` 中设置 `INITIAL_ADMIN_PASSWORD`，须符合密码规则；留空时随机生成。指定密码通过 SSH 标准输入传递，不进入命令参数、运行环境或镜像。

凭据保存到服务器部署目录下 `shared/.bootstrap-credentials.local`（权限 600），并下载至本地 `.deploy.production.account.local`，不打印到终端，不覆盖开发账号凭据。首次登录仍要求修改初始密码；修改后删除这些临时凭据。普通部署不会重复初始化管理员，也不会重置密码。不得将真实密码或其哈希写入 SQL、文档或 Git。

## 服务器目录与恢复

所有路径均相对于私有配置中的部署目录：

| 路径 | 内容 |
| --- | --- |
| `deploy.sh` | 本项目服务器执行脚本 |
| `shared/production.env`、`shared/mysql.cnf` | 当前生效的运行配置与数据库客户端凭据，权限 600 |
| `releases/<版本>/` | 版本配置、迁移日志和镜像摘要；镜像归档导入后删除 |
| `backups/<版本>.sql.gz` | 迁移前数据库备份和对应 SHA256 |
| `current-release` | 最后一次成功部署版本 |
| `runtime/` | 环境镜像传输目录；归档导入后删除 |

若在迁移前失败，或迁移明确报告没有结构变化，脚本会恢复原容器。若迁移实际执行、部分失败或无法确定是否改变结构，则保留备份与原容器并停止切换，**不会自动降级数据库**。MySQL DDL 不支持本脚本所需的整体回滚，不能仅换回旧镜像就宣称恢复完成。

人工恢复须先核对失败阶段、备份与原版本，再决定数据库恢复及应用版本。备份文件含业务数据，应限制权限并另行配置异机备份与保留期限。脚本不会删除其他容器、镜像、数据库，也不执行全局 `docker system prune`。历史发布镜像和备份保留，需定期按版本人工清理；部署目录在数据盘不代表 Docker 的镜像存储也在数据盘。

## 边界与验证口径

- 当前认证实现只接受 HTTP Origin，Cookie 未启用 Secure；此部署方案适用于受限内网 HTTP。接入 HTTPS 前必须同步修改并验证认证行为，不能只在外层加 TLS 后宣称可用。
- Node 24 在 GNU/Linux x64 的官方支持基线为内核 4.18+；Alpine/musl 属实验支持。旧系统实测通过只能证明本次基础兼容性，不能等同于官方生产支持，生产环境仍应安排系统维护升级。[Node 官方平台说明](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)
- 构建、配置测试、临时镜像验证、数据库迁移、业务验收、正式上线是不同证据。`Prepare` 和 `Validate` 不代表正式发布成功，首次真实迁移与完整业务验收需要在代码完成后执行。
- 当前脚本为单实例停机部署，不提供零停机、集群、自动数据库回滚或自动定时备份。生产数据库权限建议单独治理，运行与迁移账号目前使用同一配置。

## 本次验证记录

2026-10-15 已完成 API/网页构建、3 项环境配置测试、4 项部署打包与配置安全测试、相关 ESLint 和脚本语法检查。环境准备与实际镜像上传已执行；临时容器中的 API 存活、生产依赖、数据库只读查询、Nginx 转发及 SPA 路由均通过，验证资源已回收。真实环境地址与账号只记录在本地私有文件。

正式发布、业务库首次迁移、管理员初始化、完整业务验收及备份恢复演练尚未执行；代码完成后再执行部署流程。本次验证针对当时工作目录，不意味着后续修改也已验收。
