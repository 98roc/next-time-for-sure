# 下次一定 · Next Time, For Sure

面向小型研发团队的任务协同平台，连接需求、项目里程碑、团队分工、个人执行、周计划与周报，让安排、进展和变化都有据可查。

> **当前状态：第1～5阶段已完成，第6阶段进行中。** 个人Token与MCP业务协议已验证，Skill、桌面托盘和通知已实现，实机验收见[第6阶段实施记录](docs/development/第6阶段实施记录.md)。

实现与证据见[第3阶段实施记录](docs/development/第3阶段实施记录.md)，操作见[任务与个人执行使用说明](docs/development/任务与个人执行使用说明.md)。数据库新增需求、任务、分工、个人事项及各自进展／历史表，中文注释全部验证通过。

第4阶段已完成共享周计划、预计投入、结转、待分配发布、人工标签及周报整理／修订。入口 `/weekly-plans`、`/reports`；见[使用说明](docs/development/周计划与周报使用说明.md)和[验收记录](docs/development/第4阶段实施记录.md)。

第五阶段能力包括受限删除、项目转移／归档、成员移出与职责交接、总览和站内通知。当前通知入口为 `/collaboration`，归档交接为 `/management`，总览在团队管理中。见[使用说明](docs/development/生命周期与协作使用说明.md)及[验收记录](docs/development/第5阶段实施记录.md)。

2026-10-14已完成一轮[工作区体验改造](docs/development/工作区体验改造记录.md)：统一侧栏与品牌，项目视图分离，鱼骨图直接操作，任务详情侧栏，以及周次、编排和阅读流程整理。

2026-10-15继续完成[工作区布局与交互统一](docs/development/工作区布局与交互统一记录.md)：紧凑筛选、精简看板外框、周计划操作对齐，以及个人事项内容／进展／更多设置分区。

## 想解决什么问题

需求在聊天里提出，安排在会议中确定，执行情况散落在个人待办和周报中。项目希望把这些环节连接起来：团队看清共同目标和人员安排，个人保留自己的执行节奏，汇报能够追溯到实际工作。

## 计划能力

- **需求接收**：提交、补充、接收、暂缓或拒绝需求，接收后关联正式团队任务。
- **项目与任务**：维护里程碑、任务负责人、人员分工、子任务、进展和阻塞。
- **个人执行**：独立管理个人任务，也可关联团队工作，不强制按周组织个人空间。
- **周计划与周报**：跨项目编排人员安排，汇总实际工作，保留发布版本和后续调整。
- **权限与通知**：按角色及项目范围协作，各入口共用权限、数据与通知记录。

## 使用入口

| 入口 | 计划用途 |
| --- | --- |
| 网页 | 电脑和手机使用；从微信分享链接进入，登录后按权限办理业务 |
| Windows桌面 | 复用网页业务能力，增加托盘驻留和系统通知 |
| 外部Agent | 通过个人访问Token调用业务能力，配合Skill处理需求、任务和周报 |

外部Agent首期兼容目标为 **Codex、ZCode、Qoder、Workbody**，本轮只实际验收Codex，其他三个目标保持未验证，不阻塞本轮交付。网页与桌面端首期不内置聊天助手。

微信聊天内直接操作、飞书或语雀文档联动、存量工具数据迁移均不在首期范围。完整业务规则以需求文档为准。

## 技术方向

| 部分 | 当前选型 |
| --- | --- |
| 语言 | TypeScript，严格类型检查 |
| 网页前端 | React＋Vite |
| 业务后端 | NestJS，模块化单体 |
| 数据库 | MySQL |
| Windows桌面 | Electron，复用前端 |

网页、桌面和Agent共用后端业务服务。工程组织、数据访问及本机交付方案见[首期研发实施计划](docs/development/首期研发实施计划.md)；具体依赖版本在工程建立时锁定并验证。

## 从这里开始

- [产品需求说明书](docs/product/需求说明书.md)：产品范围、角色和目标业务行为。
- [研发需求说明书](docs/product/研发需求说明书.md)：业务规则、跨入口一致性及待验证事项。
- [首期研发实施计划](docs/development/首期研发实施计划.md)：七个实施阶段、技术约定及验收标准。
- [协作与开发规范](AGENTS.md)：代码原则、注释、验证及文档约定。
- [界面设计基准](docs/design/界面设计方向.md)：已确认的留白布局、雾蓝配色、任务看板与鱼骨式里程碑交互。
- [可操作界面原型](docs/design/prototypes/workspace.html)：下载或克隆后用浏览器打开；示例数据，不连接业务服务。

- [工程基线与验收对照](docs/development/工程基线与验收对照.md)：对象关系、权限设计及实现状态。
- [本地开发与启动](docs/development/本地开发与启动.md)：nvm、配置、迁移、运行及Codex探针接入。

在根目录配置被Git忽略的`.env.local`后，可通过PowerShell运行：

```powershell
.\scripts\pnpm.ps1 install --frozen-lockfile
.\scripts\pnpm.ps1 build
.\scripts\pnpm.ps1 db:migrate
.\scripts\pnpm.ps1 dev
```

默认网页地址为`http://127.0.0.1:5174`。工程检查使用`.\scripts\pnpm.ps1 check`，真实数据库与MCP冒烟使用`.\scripts\pnpm.ps1 smoke`。

首次初始化超管运行`.\scripts\pnpm.ps1 admin:init`（已有账号时拒绝执行）。凭据仅写入忽略的`.bootstrap-credentials.local`。访问`/account`登录并改密，再从`/organization`管理组织。当前本机保留的示例账号见忽略文件`.demo-credentials.local`。详见[账号与组织使用说明](docs/development/账号与组织使用说明.md)。

```bash
git clone https://github.com/98roc/next-time-for-sure.git
cd next-time-for-sure
```

## 参与贡献

欢迎通过Issues讨论需求、提出问题，或提交文档改进。涉及业务规则与技术方向的较大变更，请先讨论范围；提交前阅读[开发规范](AGENTS.md)，说明修改目的和验证结果。

## 开源许可证

本项目采用 [MIT License](LICENSE)。
