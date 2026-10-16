-- MySQL 5.7 只读核验；先确认客户端连接的是预期环境。
USE `next_time_for_sure`;
SELECT VERSION() AS mysql_version, DATABASE() AS database_name;

-- 当前快照预期 19 条；升级后以应用 data-source.ts 的迁移清单为准。
SELECT COUNT(*) AS applied_migrations FROM schema_migrations;
SELECT id, timestamp, name FROM schema_migrations ORDER BY id;

-- 应均为 0；是否包含中文由应用 db:status 的 Unicode 检查进一步确认。
SELECT COUNT(*) AS tables_without_comments
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COMMENT = '';
SELECT COUNT(*) AS columns_without_comments
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_COMMENT = '';

SELECT TABLE_NAME, TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;
SELECT metadata_key, metadata_value FROM platform_metadata;
SELECT role_name FROM role_policies ORDER BY role_name;

-- 刚导入 SQL 应为 0；本次生产初始化后应只有 admin 一条超级管理员账号。
-- 不查询密码哈希、会话令牌或个人 Token。
SELECT COUNT(*) AS account_count, COALESCE(SUM(is_super_admin = 1), 0) AS super_admin_count FROM accounts;
SELECT login_name, is_super_admin, disabled, must_change_password FROM accounts ORDER BY login_name;
