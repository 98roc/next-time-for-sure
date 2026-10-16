# V1 压缩基线与验收摘要

整理日期：2026-10-16。仅供当前 V1 服务维护、V2.0 迁移及历史证据追溯，不是 V2.0 的需求或权限来源。

完整旧文档保存在 Git 提交 `dafe41a5e929ddd5cfd32c9ea9bc6fb8829bf0bd` 及之前历史。按原路径可用 `git show dafe41a:docs/product/需求说明书.md` 等命令读取；本次移除旧文档的路径见[文档处置表](../../README.md#2026-10-16-文档处置)。没有把旧长文整份复制到归档目录。

## 1. 当前代码结构与入口

| 范围 | 实现及数据线索 |
| --- | --- |
| 工程 | apps/api 为 NestJS；apps/web 为 React/Vite；apps/desktop 为 Electron；apps/mcp 为 stdio 适配；packages/contracts 提供运行时输入契约，packages/ui 提供共享 UI。 |
| 身份组织 | identity、organization；accounts、login_sessions、authentication_limits、audit_events、teams、work_groups、group_members、projects、project_members、role_policies。固定代码权限已取代 role_policies 配置授权。 |
| 工作 | apps/api/src/work；work_requests、team_tasks、task_assignments、personal_items、personal_categories、各自进展与事件表。需求接收只创建任务，不等于分工和周安排。 |
| 里程碑 | project_milestones 与 team_tasks.milestone_id；独立目标，不因创建目标而创建任务，V1 目标由指定负责人确认。 |
| 周工作 | apps/api/src/weekly-plans；weekly_drafts、weekly_arrangements、weekly_pending、weekly_publications、report_drafts、work_tags、weekly_events、weekly_carry_exclusions。 |
| 生命周期与通知 | apps/api/src/lifecycle、notifications；lifecycle_events、notification_outbox、notifications 及 projects.archived。 |

现有 V1 使用入口：`/work` 为需求、任务、里程碑；`/personal` 为个人工作；`/weekly-plans` 为周计划草稿和发布；`/reports` 为周报整理和发布；`/management` 为归档交接；`/organization` 为组织及总览，通知从工作区铃铛进入。请求前缀 `/api/v1`，实际输入以 `packages/contracts/src` 及当前后端为准。

原用户操作顺序压缩为：创建需求或任务→安排分工→安排周次→个人执行→负责人整体结束→整理并发布周报。这个顺序仅用于维护 V1，不应被重新实现到 V2.0。

## 2. 迁移不能忽略的关系

- 团队任务、人员分工、个人事项是三个对象；同一任务可以多人分工，同一分工可以多个个人事项。分工转交保留旧记录，创建接手记录；父子拆分可能迁移原分工 ID，不能仅按当前标题合并。
- V1 个人最后一项完成联动本人分工，新增/重开事项恢复本人分工，不自动完成/重开整体团队任务。旧状态不是天然一致的单一任务状态。
- 周安排关联分工，目标和天数按周独立；跨周复用任务，自动延续及主动移出排除记录是 V1 行为。V2.0 改为手动加入后续区间。
- V1 已发布快照独立于源对象，人工周报含合并、排除及来源映射；来源改写或删除不改变历史副本。V2.0 取消发布机制，但必须先提取仍要保留的文字和历史事实。
- 私人事项始终归本人。团队或项目移出会撤销访问权，历史归属不因此批量改写；不能把旧工作事项一律当作私人任务。
- V1 删除有执行历史、发布引用和关联检查。2026-10-16 修复仅排除未执行分工的移除、退出、转交这类责任结束事件，保留真正执行历史限制（提交 `8b10dd9`）。V2.0 的创建人删除条件改按当前未开始状态，不能照搬旧限制。
- 旧负责人不能代改个人执行事实；V2.0 已明确允许团队/项目研发负责人代改项目任务状态。两个版本的权限必须分别验证。

## 3. 已有验证证据

以下是原记录的历史汇总，本次未重新运行测试、访问生产或执行数据库。

| 日期与范围 | 历史证据 | 不能推导的结论 |
| --- | --- | --- |
| 2026-10-13 工程、账号组织 | PowerShell 5.1、项目 Node/pnpm、类型/Lint/构建；真实 HTTP/MySQL 身份、CSRF、会话撤销、组织权限和版本竞争；Codex 公开探针成功。 | 探针不是 Agent 业务写入验收。 |
| 2026-10-13 任务执行 | work:smoke 覆盖需求竞争、分工、个人隐私、拆分、状态时间、排序和阻塞；浏览器覆盖主要操作及 390px 深浅色布局。 | 浏览器视口模拟不是手机实机；非所有角色全流程人工验证。 |
| 2026-10-14 周计划、周报与生命周期 | weekly:smoke 完成连续两周、人工文字保护、发布冻结；lifecycle:smoke 完成转移、归档、删除、撤权；故障注入验证通知回滚与重试去重。 | 不能用于证明 V2.0 无发布流程、单任务模型已实现。 |
| 2026-10-14 桌面与 Agent | Token/API 与 MCP stdio 查询、写入、确认和权限回归通过；用户配合验证安装、托盘、退出、通知点击、最小化和跨启动去重。 | 桌面账号切换通知隔离仍缺实机证据。 |
| 2026-10-14 真实 Codex | 身份、组织、工作查询及越权拒绝有证据；写入被客户端 approval policy 拦截，未绕过。 | 真实 Codex 完整业务写入未通过；ZCode、Qoder、Workbody 未验证。 |
| 2026-10-15 独立里程碑、直属分工、个人联动 | 真实 API/MySQL 验证独立目标、自动延续、直属权限、最后个人事项联动、幂等及历史；本地中文注释最终记录 272/272。 | 曾有并行回归 HTTP 500，单独重跑未复现，未定位根因；不算已修复。 |
| 2026-10-15 工作区与周计划 | 布局、分工选择、双周安排、三视图及文字复制有静态、集成和必要浏览器检查；部分后续微调仅静态或隔离 UI 检查。 | 不把未提交用户业务变更的页面查看称为写入验收。 |
| 2026-10-15 账号与桌面更新 | 30天滑动会话、8位密码规则有真实API回归；桌面设置IPC、站点隔离、NSIS更新下载和SHA-512校验有隔离运行证据。 | 未验证真实用户安装目录覆盖升级；安装包未签名。 |
| 2026-10-16 部署与SQL | 空库快照19迁移、导入后新增0、注释272/272；部署、健康、身份及HTTP UUID兼容有记录。 | 完整生产业务回归和备份恢复演练未完成；当前线上版本必须另行查询。 |

原截图、脱敏协议及桌面运行附件保留在[验收证据索引](../../development/evidence/README.md)。生产部署过程及环境限制继续维护在[部署说明](../../development/Docker部署.md)。

## 4. 维护边界

- V1 仍在代码中运行，文档删除不表示接口或数据库已删除。三份 `.agents/skills` 仍调用 V1 命令，仅用于当前 V1 服务。
- `scripts/pnpm.ps1 check` 是静态、测试及构建入口；各类真实 API/数据库 smoke 需独立执行，不能将旧测试数量写成当前测试结果。
- 所有旧阶段的“尚未开始”“未实现”等阶段性语句不再作为当前状态展示；以本摘要中日期更晚的证据与当前代码核对为准。
- 不保留 V1 旧原型作为新开发入口；视觉基准统一到 [V2.0 组件规范](../../design/V2.0组件与交互规范.md)。
