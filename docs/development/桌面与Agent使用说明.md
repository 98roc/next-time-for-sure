# 桌面与Agent使用说明

第6阶段进行中；实际验证范围见[实施记录](第6阶段实施记录.md)。

## 个人Token

登录`/account`，填写用途名称，选择到期时间或确认永久有效风险。生成后立即保存完整Token至不入库的本地文件，例如`.agent-token.local`，文件只含Token。离开页面后不再提供明文。疑似泄露或停用时在同一页面撤销。

Token代表当前用户，不额外配置读写或项目范围。被禁用、到期、撤销时拒绝；成员或角色变化实时生效。Agent不能创建、查询列表或撤销Token，即使同时携带登录Cookie也拒绝管理请求。

## MCP接入

先构建并启动API。按[Codex官方MCP配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)配置本地stdio；将示例路径替换为实际路径，不把明文放进配置或对话：

```toml
[mcp_servers.next_time_for_sure]
command = 'powershell.exe'
args = ['-NoProfile', '-File', 'G:\work\project\next-time-for-sure\scripts\mcp.ps1']

[mcp_servers.next_time_for_sure.env]
MCP_API_URL = 'http://127.0.0.1:3100'
NTFS_TOKEN_FILE = 'G:\work\project\next-time-for-sure\.agent-token.local'
```

也可由调用进程提供`NTFS_ACCESS_TOKEN`，不得与文件配置同时使用。地址只接受本机HTTP origin，不接受外部URL、路径、查询或内嵌凭据。不配置Token时仅启用`system_health`。

| 工具 | 范围 |
| --- | --- |
| business_query | 身份、组织、需求任务、分工、个人执行、周计划、周报、标签、交接历史、总览、通知及影响预览 |
| business_command | 对应网页业务命令，沿用各模块输入契约和当前权限；包含组织管理、里程碑增删改、拆分及执行维护 |
| lifecycle_preview | 删除、转移、归档及成员移出的当前影响和确认摘要 |
| system_health | 无需认证的工程探针，不表示身份或业务成功 |

先查询最新状态，必要时预览并在对话确认；版本变化返回409后重新查询和确认。创建重试沿用同一`operationId`。超时可能已提交，先回读再判断，不直接重复创建。工具固定白名单不提供任意HTTP代理，权限仍由API负责。

三个Skill随仓库放在`.agents/skills`，可在该仓库的Codex中明确调用`$ntfs-requirements`、`$ntfs-team-tasks`、`$ntfs-weekly-reports`。其他工作目录可按客户端支持的Skill加载方式使用这些目录；不复制凭据。周报Skill对仅有项目角色的用户只做可见内容总结，不写入团队草稿。

## Windows客户端

先启动本机API与网页，再运行：

```powershell
.\scripts\pnpm.ps1 --filter @ntfs/desktop dev
# 构建Windows x64安装程序
.\scripts\pnpm.ps1 --filter @ntfs/desktop package
```

默认连接`http://127.0.0.1:5174`，可通过`DESKTOP_WEB_URL`指定其他本机端口。客户端不包含数据库或后台服务，也不支持离线写入。

关闭窗口隐藏到托盘，托盘可打开主页或协作通知页；“退出”终止进程及通知轮询。系统通知只展示当前登录且仍有权限的通知，点击后再次校验。展示不会自动标记已读，网页或桌面操作共用数据库已读状态。

展示去重文件位于Electron用户数据目录`notification-ledger.json`，保存账号和事件标识；不要把删除该文件作为日常清理操作，否则可能再次展示旧未读通知。文件损坏时客户端明确启动失败，避免静默丢失去重记录。
