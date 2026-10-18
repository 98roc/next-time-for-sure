# 下次一定 · Next Time, For Sure

面向小型研发团队的任务协同平台，将项目安排、个人执行、里程碑与区间总结连接起来。

**当前状态：V2.0 开发分支已接入新版页面、API 与 MCP，旧业务入口已移除；生产仍为 V1。** 数据转换、恢复及完整多端验收尚未完成，详见[V2.0 实施记录](docs/development/V2.0实施记录.md)。

## 产品愿景

**让团队协作与个人工作自然连接，让每一份计划和变化都有人承接，让每个人都能以适合自己的方式，与 AI 一起推进工作。**

长期方向是连接团队与个人执行、承接计划内外工作、融入日常网页和桌面环境、让 Agent 按同样权限操作业务，以及探索个人与 AI 定制工作空间。长期愿景不扩张本轮范围；V2.0 以四个入口的已确认文档为准，未保留的 V1 业务取消。

## V2.0 从这里开始

| 入口 | 职责与设计 |
| --- | --- |
| 我的工作 | [项目/私人任务共用看板、默认状态分类与个人排序](docs/design/V2.0我的工作设计.md) |
| 周报与周计划 | [日期区间、双栏总结安排、共享排序和文字](docs/design/V2.0周报与周计划设计.md) |
| 项目 | [单执行人任务、待建任务、里程碑及跨项目概览](docs/design/V2.0项目设计.md) |
| 团队管理 | [成员、项目角色、多人负责人及团队文案](docs/design/V2.0团队管理设计.md) |

- [文档导航与处置说明](docs/README.md)
- [产品需求](docs/product/需求说明书.md) / [研发需求与验收](docs/product/研发需求说明书.md)
- [产品结构](docs/design/V2.0产品结构设计.md) / [组件与交互规范](docs/design/V2.0组件与交互规范.md)
- [交互原型及维护方法](docs/design/prototypes/README.md)：三套模拟页面，下载或克隆后用浏览器打开。
- [迁移与研发准备](docs/development/V2.0迁移与研发准备.md)：开发库可重建，生产保留可承接数据并删除取消功能专属数据。
- [推荐协作方式](docs/product/推荐协作方式.md) / [协作与开发规范](AGENTS.md)

## 工程与本地启动

TypeScript 严格模式；React/Vite 前端、NestJS 模块化后端、MySQL、Electron 桌面与 MCP 适配器。网页、桌面及 Agent 共用后端规则。

运行时以 `.node-version` 为准，包管理器以 `package.json` 为准；Windows PowerShell 5.1 使用项目脚本，不切换全局工具链。首次从 `.env.example` 创建被 Git 忽略的 `.env.local` 并填写本地配置，已有文件不要覆盖。

```powershell
.\scripts\pnpm.ps1 install --frozen-lockfile
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 db:migrate
.\scripts\pnpm.ps1 dev
```

默认网页为 `http://127.0.0.1:5174`；上述命令建立当前结构，不自动转换已有 V1 业务数据。首次超管初始化使用 `.\scripts\pnpm.ps1 admin:init`，已有账号时拒绝执行，凭据仅写入忽略的本地文件。

- [本地开发与启动](docs/development/本地开发与启动.md)：环境、入口、检查及真实 API 验收。
- [账号与组织使用说明](docs/development/账号与组织使用说明.md)：当前运行版本。
- [桌面与 Agent 使用说明](docs/development/桌面与Agent使用说明.md)：当前客户端配置、Token 和 V2 MCP。
- [Docker 部署](docs/development/Docker部署.md) / [数据库脚本](database/README.md)：现有服务的部署、备份及迁移限制。
- [V1 压缩基线与验收摘要](docs/archive/v1/README.md)：旧模型、历史证据及未验证边界。

工程检查使用 `.\scripts\pnpm.ps1 check`；真实 API/数据库、浏览器、Electron 与外部 Agent 验证分别记录，不能相互替代。

## 参与贡献

欢迎通过 Issues 讨论需求或提交改进。提交前阅读[开发规范](AGENTS.md)，说明范围及验证结果；私有配置、密码、Token 和业务备份不得进入 Git。

本项目采用 [MIT License](LICENSE)。
