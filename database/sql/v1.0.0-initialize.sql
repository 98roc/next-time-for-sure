-- Release 1.0.0 / MySQL 5.7 empty-database snapshot; through PersonalWorkflow1792022401000 (19 migrations).
-- Generated from migrations in an isolated empty database. No accounts or credentials.
-- Do not run against an existing database. Do not use mysql --force.
CREATE DATABASE `next_time_for_sure` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `next_time_for_sure`;
SET NAMES utf8mb4;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';

CREATE TABLE `accounts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账号唯一标识',
  `login_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录名，全局唯一',
  `display_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户显示姓名',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '加盐密码派生值，不存储明文密码',
  `is_super_admin` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否为超级管理员：零否，一是',
  `disabled` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否停用：零启用，一停用',
  `must_change_password` tinyint(4) NOT NULL DEFAULT '1' COMMENT '是否必须修改密码：零否，一是',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '账号版本号，用于并发冲突检查',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '当前所属团队标识，空表示未加入团队',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_accounts_login` (`login_name`),
  KEY `fk_account_team` (`team_id`),
  CONSTRAINT `fk_account_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户账号及当前团队归属';

CREATE TABLE `assignment_progress` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '进展记录唯一标识',
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源人员分工标识，用于去重归集',
  `occurred_on` date NOT NULL COMMENT '实际发生日期，不随汇报周期修改',
  `report_week` date NOT NULL COMMENT '汇报归属周的周一日期',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本条实际进展内容',
  `created_at` datetime(3) NOT NULL COMMENT '记录创建时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `fk_progress_assignment` (`assignment_id`),
  KEY `idx_progress_week` (`report_week`,`assignment_id`),
  CONSTRAINT `fk_progress_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员分工逐条进展及汇报归属';

CREATE TABLE `audit_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '审计事件唯一标识',
  `actor_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作账号标识',
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型编码',
  `subject_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '被审计对象标识',
  `created_at` datetime(3) NOT NULL COMMENT '操作时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号与组织操作审计记录';

CREATE TABLE `authentication_limits` (
  `bucket_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '请求来源限流分桶摘要',
  `failures` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '当前窗口已消耗认证尝试次数，包含成功尝试',
  `window_start` datetime(3) NOT NULL COMMENT '计数窗口起始时间（协调世界时）',
  PRIMARY KEY (`bucket_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='认证请求频率限制';

CREATE TABLE `group_members` (
  `group_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属小组标识',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '成员账号标识，须属于小组所在团队',
  PRIMARY KEY (`group_id`,`account_id`),
  KEY `fk_gm_account` (`account_id`),
  CONSTRAINT `fk_gm_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_gm_group` FOREIGN KEY (`group_id`) REFERENCES `work_groups` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小组成员关系，同一账号可加入多个小组';

CREATE TABLE `lifecycle_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '生命周期历史标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '变更所属原团队',
  `actor_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作账号',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对象标识，删除后保留引用',
  `action` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '删除转移归档或移出操作',
  `payload_json` json NOT NULL COMMENT '原因及操作前后影响范围快照',
  `created_at` datetime(3) NOT NULL COMMENT '发生时间，协调世界时',
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  CONSTRAINT `lifecycle_events_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生命周期及人员交接历史，不提供恢复删除';

CREATE TABLE `login_sessions` (
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话令牌摘要，不存储原始令牌',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属账号标识',
  `csrf_token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '跨站请求伪造防护校验值',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  `expires_at` datetime(3) NOT NULL COMMENT '失效时间（协调世界时）',
  PRIMARY KEY (`token_hash`),
  KEY `idx_session_account` (`account_id`),
  KEY `idx_session_expiry` (`expires_at`),
  CONSTRAINT `fk_session_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话及跨站请求校验信息';

CREATE TABLE `notification_outbox` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务通知事件标识，同一事件重复投递复用',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件所属团队',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联项目，可空表示团队事件',
  `payload_json` json NOT NULL COMMENT '收件人及最小业务提示，不含私人事项',
  `delivered` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否完成站内投递，失败时保留待重试',
  `attempts` int(11) NOT NULL DEFAULT '0' COMMENT '投递尝试次数',
  `created_at` datetime(3) NOT NULL COMMENT '事件发生时间，协调世界时',
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  CONSTRAINT `notification_outbox_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='与业务同事务写入的可靠通知事件箱';

CREATE TABLE `notifications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户通知标识',
  `event_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源业务事件',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '接收账号',
  `read_at` datetime(3) DEFAULT NULL COMMENT '用户主动阅读时间，系统展示不写入',
  `created_at` datetime(3) NOT NULL COMMENT '投递时间，协调世界时',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_recipient` (`event_id`,`account_id`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `notification_outbox` (`id`),
  CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='多端共用站内通知和已读状态，同事件同用户唯一';

CREATE TABLE `personal_categories` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人分类唯一标识',
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类所属账号，仅本人管理',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户自定义分类名称，执行阶段由状态字段决定',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '分类并发版本号',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started' COMMENT '分类对应执行状态：未开始、进行中、已完成',
  PRIMARY KEY (`id`),
  KEY `fk_category_owner` (`owner_id`),
  CONSTRAINT `fk_category_owner` FOREIGN KEY (`owner_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人空间自定义分类';

CREATE TABLE `personal_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人事项历史唯一标识',
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '历史所属账号，私人历史仅本人可见',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人事项或分类标识',
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作编码',
  `payload_json` json NOT NULL COMMENT '个人内容变更快照，不进入团队侧审计详情',
  `created_at` datetime(3) NOT NULL COMMENT '操作时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `idx_personal_history` (`owner_id`,`object_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='隔离保存的个人事项及分类历史';

CREATE TABLE `personal_items` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人事项唯一标识',
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属账号，内容和执行事实仅本人修改',
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事项类型编码：工作或私人，私人仅本人可见',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '工作所属项目，私人事项为空',
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联本人团队分工，独立工作和私人事项为空',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人事项标题',
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人说明，允许为空',
  `acceptance` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人完成标准，允许为空',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started' COMMENT '本人执行状态编码：待开始、进行中、完成',
  `checklist_json` json NOT NULL COMMENT '一层检查清单，仅保存内容及勾选结果',
  `category_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本人分类标识，空为未分类',
  `position` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '分类内个人排序位置，不改变执行状态',
  `planned_on` date DEFAULT NULL COMMENT '本人计划日期，不构成团队交付承诺',
  `blocked_reason` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '阻塞说明，空表示未标记阻塞',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '个人事项并发版本号',
  `started_at` datetime(3) DEFAULT NULL COMMENT '本人实际开始时间（协调世界时）',
  `ended_at` datetime(3) DEFAULT NULL COMMENT '本人实际结束时间（协调世界时）',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `fk_personal_owner` (`owner_id`),
  KEY `fk_personal_project` (`project_id`),
  KEY `fk_personal_assignment` (`assignment_id`),
  KEY `fk_personal_category` (`category_id`),
  CONSTRAINT `fk_personal_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments` (`id`),
  CONSTRAINT `fk_personal_category` FOREIGN KEY (`category_id`) REFERENCES `personal_categories` (`id`),
  CONSTRAINT `fk_personal_owner` FOREIGN KEY (`owner_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_personal_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人工作任务及严格隔离的私人事项';

CREATE TABLE `personal_progress` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人进展唯一标识',
  `item_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源个人事项标识，用于权限和归集去重',
  `occurred_on` date NOT NULL COMMENT '实际发生日期',
  `report_week` date NOT NULL COMMENT '汇报归属周的周一日期，独立于发生日期',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '逐条进展内容，私人进展不对团队开放',
  `created_at` datetime(3) NOT NULL COMMENT '记录创建时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `fk_personal_progress` (`item_id`),
  CONSTRAINT `fk_personal_progress` FOREIGN KEY (`item_id`) REFERENCES `personal_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人事项进展及汇报归属';

CREATE TABLE `personal_tokens` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '个人访问凭据标识',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '凭据所属账号，每次使用重新验证当前权限',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本人填写的用途名称',
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '随机凭据的SHA256摘要，不存明文',
  `created_at` datetime(3) NOT NULL COMMENT '生成时间，协调世界时',
  `expires_at` datetime(3) DEFAULT NULL COMMENT '到期时间，空表示本人确认永久有效',
  `revoked_at` datetime(3) DEFAULT NULL COMMENT '撤销时间，非空即不可认证',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_personal_token_hash` (`token_hash`),
  KEY `idx_personal_token_account` (`account_id`),
  CONSTRAINT `personal_tokens_ibfk_1` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人访问Token摘要及生命周期，不授予独立业务权限';

CREATE TABLE `platform_metadata` (
  `metadata_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '元数据唯一键',
  `metadata_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '元数据值',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  PRIMARY KEY (`metadata_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台工程基线元数据';
INSERT INTO `platform_metadata` (`metadata_key`, `metadata_value`, `created_at`) VALUES ('schema_baseline', 'foundation-v1', UTC_TIMESTAMP(3));

CREATE TABLE `project_members` (
  `project_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目标识',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '成员账号标识，须属于项目所在团队',
  `roles_json` json NOT NULL COMMENT '项目角色编码数组，可兼任项目经理、项目负责人、开发人员',
  PRIMARY KEY (`project_id`,`account_id`),
  KEY `fk_pm_account` (`account_id`),
  CONSTRAINT `fk_pm_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_pm_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员及兼任角色';

CREATE TABLE `project_milestones` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '里程碑标识',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目标识',
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '里程碑负责人，负责确认目标达成',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '阶段目标名称',
  `expected_on` date DEFAULT NULL COMMENT '预计达成日期，空表示未规划日期',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open' COMMENT '目标状态：open未完成、completed已确认完成、removed已移出',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '并发版本',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间，协调世界时',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间，协调世界时',
  PRIMARY KEY (`id`),
  KEY `idx_milestone_project` (`project_id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `project_milestones_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `project_milestones_ibfk_2` FOREIGN KEY (`owner_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='独立项目里程碑，不自动产生团队任务';

CREATE TABLE `projects` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目唯一标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属团队标识',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目名称',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '项目版本号，用于成员及角色并发冲突检查',
  `archived` tinyint(4) NOT NULL DEFAULT '0' COMMENT '项目是否归档，归档后禁止新增执行工作',
  PRIMARY KEY (`id`),
  KEY `fk_project_team` (`team_id`),
  CONSTRAINT `fk_project_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队项目';

CREATE TABLE `report_drafts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '共享周报草稿标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属团队',
  `week` date NOT NULL COMMENT '周报归属周周一',
  `version` int(11) NOT NULL DEFAULT '0' COMMENT '草稿并发版本',
  `entries_json` json NOT NULL COMMENT '人工整理条目及完整来源映射，排除项保留',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_draft` (`team_id`,`week`),
  CONSTRAINT `report_drafts_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队共享周报草稿与增量整理结果';

CREATE TABLE `role_policies` (
  `role_name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '预设角色唯一编码',
  `permissions_json` json NOT NULL COMMENT '角色权限编码数组，不可突破固定业务边界',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '策略版本号，用于并发冲突检查',
  PRIMARY KEY (`role_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预设角色的可配置权限策略';
INSERT INTO `role_policies` (`role_name`, `permissions_json`, `version`) VALUES ('developer', '[\"tasks.create\"]', 1);
INSERT INTO `role_policies` (`role_name`, `permissions_json`, `version`) VALUES ('group_leader', '[\"work.assign\"]', 0);
INSERT INTO `role_policies` (`role_name`, `permissions_json`, `version`) VALUES ('project_lead', '[\"requests.accept\",\"milestones.manage\",\"tasks.create\"]', 1);
INSERT INTO `role_policies` (`role_name`, `permissions_json`, `version`) VALUES ('project_manager', '[\"requests.submit\"]', 1);
INSERT INTO `role_policies` (`role_name`, `permissions_json`, `version`) VALUES ('team_leader', '[\"members.manage\",\"groups.manage\",\"projects.manage\",\"work.assign\",\"requests.accept\",\"milestones.manage\",\"reports.publish\",\"requests.submit\",\"tasks.create\"]', 2);

CREATE TABLE `schema_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '迁移记录自增编号',
  `timestamp` bigint(20) NOT NULL COMMENT '迁移定义时间戳（毫秒）',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '已执行迁移名称',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库结构迁移执行记录';
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (1, 1791849600000, 'Foundation1791849600000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (2, 1791849601000, 'Identity1791849601000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (3, 1791849602000, 'Organization1791849602000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (4, 1791849603000, 'SchemaComments1791849603000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (5, 1791849604000, 'WorkIntake1791849604000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (6, 1791849605000, 'Assignments1791849605000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (7, 1791849606000, 'Personal1791849606000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (8, 1791849607000, 'Milestones1791849607000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (9, 1791849608000, 'TaskLifecycle1791849608000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (10, 1791849609000, 'SplitOrigin1791849609000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (11, 1791849610000, 'BoardOrder1791849610000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (12, 1791849611000, 'Blockers1791849611000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (13, 1791849612000, 'WeeklyDrafts1791849612000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (14, 1791849613000, 'WeeklyPublications1791849613000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (15, 1791849614000, 'LifecycleNotifications1791849614000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (16, 1791849615000, 'PersonalTokens1791849615000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (17, 1791936000000, 'IndependentMilestones1791936000000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (18, 1792022400000, 'TeamDirectAssignments1792022400000');
INSERT INTO `schema_migrations` (`id`, `timestamp`, `name`) VALUES (19, 1792022401000, 'PersonalWorkflow1792022401000');

CREATE TABLE `task_assignments` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人员分工唯一标识',
  `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属可执行团队任务标识',
  `account_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '执行人账号标识',
  `group_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责小组标识；空表示由团队负责人统筹的团队直属分工',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分工内容，允许为空',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分工来源编码：管理分配或自行认领',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started' COMMENT '执行状态编码：待开始、进行中、完成、退出、转交',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '并发编辑版本号',
  `started_at` datetime(3) DEFAULT NULL COMMENT '本人实际开始时间（协调世界时）',
  `ended_at` datetime(3) DEFAULT NULL COMMENT '本人实际结束时间（协调世界时），转交不伪造此时间',
  `transferred_at` datetime(3) DEFAULT NULL COMMENT '分工转交时间（协调世界时）',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
  `active_account` char(36) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS ((case when (`status` in ('exited','transferred')) then NULL else `account_id` end)) STORED COMMENT '有效执行人标识，退出或转交为空，用于防重复有效分工',
  `origin_task_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首次拆分前所属团队任务，空表示未发生拆分迁移',
  `blocked_reason` varchar(2000) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '阻塞原因，空表示未阻塞或已人工解除',
  `waiting_for` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '等待对象说明，可空，不自动限制开工',
  `waiting_task_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '等待的同项目团队任务，完成不会自动解除阻塞',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assignment_active` (`task_id`,`active_account`),
  KEY `fk_assignment_account` (`account_id`),
  KEY `fk_assignment_group` (`group_id`),
  KEY `fk_assignment_origin` (`origin_task_id`),
  KEY `fk_task_assignments_waiting` (`waiting_task_id`),
  CONSTRAINT `fk_assignment_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_assignment_group` FOREIGN KEY (`group_id`) REFERENCES `work_groups` (`id`),
  CONSTRAINT `fk_assignment_origin` FOREIGN KEY (`origin_task_id`) REFERENCES `team_tasks` (`id`),
  CONSTRAINT `fk_assignment_task` FOREIGN KEY (`task_id`) REFERENCES `team_tasks` (`id`),
  CONSTRAINT `fk_task_assignments_waiting` FOREIGN KEY (`waiting_task_id`) REFERENCES `team_tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队任务人员分工及本人执行状态';

CREATE TABLE `team_tasks` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '团队任务唯一标识',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目标识',
  `request_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源需求标识，直接创建时为空',
  `parent_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '父任务标识，仅允许一层子任务',
  `owner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务主负责人账号标识，不等同于执行分工',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务标题',
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务说明，允许为空',
  `acceptance` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '完成标准，允许为空',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'not_started' COMMENT '执行状态编码，待分配不作为执行状态',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '并发编辑版本号',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
  `in_milestone` tinyint(3) unsigned NOT NULL DEFAULT '0' COMMENT '是否列入项目里程碑，移出不删除任务',
  `expected_on` date DEFAULT NULL COMMENT '里程碑预计完成日期，空表示尚未规划日期',
  `started_at` datetime(3) DEFAULT NULL COMMENT '团队任务首次实际开始时间，不从关联对象传播',
  `ended_at` datetime(3) DEFAULT NULL COMMENT '本任务整体完成时间，重开后清空，历史另存',
  `progress` tinyint(3) unsigned NOT NULL DEFAULT '0' COMMENT '主负责人维护的累计进度百分比，不自动改变完成状态',
  `position` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '团队状态列内排序位置，不表达优先级或执行状态',
  `blocked_reason` varchar(2000) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '阻塞原因，空表示未阻塞或已人工解除',
  `waiting_for` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '等待对象说明，可空，不自动限制开工',
  `waiting_task_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '等待的同项目团队任务，完成不会自动解除阻塞',
  `milestone_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联里程碑，一条任务最多关联一个，同项目',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_task_request` (`request_id`),
  KEY `fk_task_parent` (`parent_id`),
  KEY `fk_task_owner` (`owner_id`),
  KEY `idx_task_milestone` (`project_id`,`in_milestone`,`expected_on`),
  KEY `fk_team_tasks_waiting` (`waiting_task_id`),
  KEY `idx_task_milestone_id` (`milestone_id`),
  CONSTRAINT `fk_task_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `project_milestones` (`id`),
  CONSTRAINT `fk_task_owner` FOREIGN KEY (`owner_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_task_parent` FOREIGN KEY (`parent_id`) REFERENCES `team_tasks` (`id`),
  CONSTRAINT `fk_task_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_task_request` FOREIGN KEY (`request_id`) REFERENCES `work_requests` (`id`),
  CONSTRAINT `fk_team_tasks_waiting` FOREIGN KEY (`waiting_task_id`) REFERENCES `team_tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队任务及来源需求关联';

CREATE TABLE `teams` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '团队唯一标识',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '团队名称',
  `leader_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '团队负责人账号标识',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '团队版本号，用于并发冲突检查',
  `created_at` datetime(3) NOT NULL COMMENT '创建时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `fk_team_leader` (`leader_id`),
  CONSTRAINT `fk_team_leader` FOREIGN KEY (`leader_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队及团队负责人';

CREATE TABLE `weekly_arrangements` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人员周安排标识',
  `draft_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属共享周计划草稿',
  `assignment_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人员分工标识，跟随原分工拆分迁移',
  `goal` varchar(2000) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '本周工作目标，允许空',
  `expected_progress` tinyint(3) unsigned DEFAULT NULL COMMENT '本周预计新增进度百分比，允许空，不是累计进度',
  `planned_days` decimal(6,2) DEFAULT NULL COMMENT '本周预计投入天数，允许空，不代表实际工时',
  `source_week` date DEFAULT NULL COMMENT '自动结转来源周，手动安排为空',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '安排并发版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weekly_assignment` (`draft_id`,`assignment_id`),
  KEY `assignment_id` (`assignment_id`),
  CONSTRAINT `weekly_arrangements_ibfk_1` FOREIGN KEY (`draft_id`) REFERENCES `weekly_drafts` (`id`),
  CONSTRAINT `weekly_arrangements_ibfk_2` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每人每周具体分工的目标及预计投入';

CREATE TABLE `weekly_carry_exclusions` (
  `draft_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主动移出工作所在周草稿',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分工或待分配任务标识',
  `object_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对象类型：assignment分工或task待分配任务',
  PRIMARY KEY (`draft_id`,`object_id`,`object_kind`),
  CONSTRAINT `weekly_carry_exclusions_ibfk_1` FOREIGN KEY (`draft_id`) REFERENCES `weekly_drafts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='阻止主动移出工作被自动重新结转，重新安排后恢复延续';

CREATE TABLE `weekly_drafts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '共享周计划草稿标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属团队标识',
  `week` date NOT NULL COMMENT '归属周的周一日期',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '草稿变更版本，用于发布确认',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weekly_team` (`team_id`,`week`),
  CONSTRAINT `weekly_drafts_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队每周唯一的共享计划草稿';

CREATE TABLE `weekly_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '周业务变更记录标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属团队',
  `actor_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作账号',
  `action` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `payload_json` json NOT NULL COMMENT '变更前后及原因，不覆盖历史',
  `created_at` datetime(3) NOT NULL COMMENT '发生时间，协调世界时',
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  CONSTRAINT `weekly_events_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='周安排、周报及人工标签的变更历史';

CREATE TABLE `weekly_pending` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '待分配周事项标识',
  `draft_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属共享草稿',
  `task_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '待落实执行人员的团队任务',
  `version` int(11) NOT NULL DEFAULT '0' COMMENT '并发修改版本',
  `source_week` date DEFAULT NULL COMMENT '自动延续来源周，手动加入为空',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pending_task` (`draft_id`,`task_id`),
  KEY `task_id` (`task_id`),
  CONSTRAINT `weekly_pending_ibfk_1` FOREIGN KEY (`draft_id`) REFERENCES `weekly_drafts` (`id`),
  CONSTRAINT `weekly_pending_ibfk_2` FOREIGN KEY (`task_id`) REFERENCES `team_tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='允许随周计划发布的待分配事项';

CREATE TABLE `weekly_publications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发布版本标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发布所属团队',
  `week` date NOT NULL COMMENT '归属周周一',
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发布种类：计划或周报',
  `revision` int(11) NOT NULL COMMENT '同周同种类的递增修订号',
  `payload_json` json NOT NULL COMMENT '发布时完整内容快照，不跟随源记录修改',
  `created_at` datetime(3) NOT NULL COMMENT '发布时间，协调世界时',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_week_publication` (`team_id`,`week`,`kind`,`revision`),
  CONSTRAINT `weekly_publications_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='不可变周计划及周报发布版本';

CREATE TABLE `work_events` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '历史事件唯一标识',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目标识，用于权限裁剪',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求或任务标识，历史不依赖对象仍存在',
  `actor_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作人账号标识',
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务操作编码',
  `payload_json` json NOT NULL COMMENT '操作内容及变更快照，不含认证凭据',
  `created_at` datetime(3) NOT NULL COMMENT '事件发生时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `idx_work_event_object` (`object_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求及团队任务变更历史';

CREATE TABLE `work_groups` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '小组唯一标识',
  `team_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属团队标识',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '小组名称',
  `leader_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '组长账号标识，须为本组成员',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '小组版本号，用于并发冲突检查',
  PRIMARY KEY (`id`),
  KEY `fk_group_team` (`team_id`),
  KEY `fk_group_leader` (`leader_id`),
  CONSTRAINT `fk_group_leader` FOREIGN KEY (`leader_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_group_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队工作小组';

CREATE TABLE `work_operations` (
  `actor_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作人账号标识',
  `operation_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户端生成的幂等操作标识',
  `payload_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '命令内容摘要，防止同键不同内容复用',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本次操作产生或处理的对象标识',
  `created_at` datetime(3) NOT NULL COMMENT '操作提交时间（协调世界时）',
  PRIMARY KEY (`actor_id`,`operation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成功写入操作幂等记录';

CREATE TABLE `work_requests` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求唯一标识',
  `project_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目标识',
  `submitter_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求提交人账号标识',
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求标题',
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求说明，允许为空',
  `acceptance` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '完成标准，允许为空',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '处理状态：待处理、待补充、暂缓、拒绝、撤回、已接收的编码',
  `version` int(10) unsigned NOT NULL DEFAULT '0' COMMENT '并发编辑版本号',
  `created_at` datetime(3) NOT NULL COMMENT '提交时间（协调世界时）',
  `updated_at` datetime(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
  PRIMARY KEY (`id`),
  KEY `fk_request_project` (`project_id`),
  KEY `fk_request_submitter` (`submitter_id`),
  CONSTRAINT `fk_request_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_request_submitter` FOREIGN KEY (`submitter_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目需求及当前处理状态';

CREATE TABLE `work_tags` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人工标签标识',
  `object_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '团队任务或个人工作标识',
  `object_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对象类型：任务或个人工作',
  `dimension` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签维度：里程碑外或周计划外',
  `week_key` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '周计划外标签的周一日期，里程碑外为空',
  `marked` tinyint(4) NOT NULL COMMENT '是否人工标记，零表示人工清除',
  `version` int(11) NOT NULL DEFAULT '0' COMMENT '标签并发版本',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_work_tag` (`object_id`,`object_kind`,`dimension`,`week_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作事项人工计划外标签，不根据日期自动推断';

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE=@OLD_SQL_MODE;
