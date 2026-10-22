---
name: ntfs-weekly-reports
description: 根据下次一定 V2.0 当前可见任务与历史整理周报和周计划，维护共享文字，区分团队负责人写入与其他成员只读总结。
---

先用已配置 MCP 的 `business_query` 查询 `agent/me` 和 `v2/workspace`，按服务端上海日期及团队维护的连续区间确定总结、计划两个相邻区间 ID，再查 `v2/weekly`。不把自定义区间强行当自然周，不读取或管理 Token。

总结使用区间内安排或实际执行的历史事实，名称、执行人、状态按历史快照；不能拿当前状态改写过去。私人任务不进入团队周报。计划沿用同一任务的安排与共享顺序，不自动结转或复制。

- 团队负责人可通过 `business_command` 的 `v2/report` 保存手工文字（save）、核对保留原文（verify）或重新生成（regenerate）。其余身份只查询当前有权范围的生成文本并在对话总结，不能读取或写入全团队人工稿。
- 写入需当前 summaryPeriodId、planPeriodId、version、sourceHash 和稳定 operationId。来源变化先展示差异与待同步状态，保留用户文字；禁止悄悄覆盖。
- 重新生成先向用户展示当前 generatedText 预览。取得对覆盖原文的具体授权后，携带该预览对应 sourceHash 和版本提交。409 时重新读取和核对，不能替换摘要后静默提交。
- 复制当前显示的文字；项目筛选和按人员视角不能改变共享稿的管理范围。没有发布、审批或发布快照操作，保存结果不得称为发布成功。

写入后回读 `v2/weekly` 核实文字、版本和同步状态。失败只报告实际错误，超时先查询确认，不编造执行记录。

私人日报独立于团队周报：查询 `v2/daily`，query 为 `{ on: "YYYY-MM-DD" }`，默认取 workspace.today；只读取本人当日完成主任务和子任务，不将这些私人内容混入团队稿。保存同路径使用 save_daily、verify_daily、regenerate_daily，参数 on、version、sourceHash、body、operationId；重新生成仍需先展示 generatedText 并确认覆盖，完成后回读。项目默认跟随项目页顺序；本人偏好由 `v2/personal-settings` 维护（set_daily_project_order 的 projectIds 为当前有权项目完整顺序，null 恢复跟随；set_completed_mode 的 mode 为 day/period），使用 workspace.personalPreferences.version。日期模式和排序只作用于本人，不代表日报发布。
