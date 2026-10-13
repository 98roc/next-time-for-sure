import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 补齐已建立结构的中文注释；显式保留字段类型、默认值和自增属性。 */
export class SchemaComments1791849603000 implements MigrationInterface {
  name = 'SchemaComments1791849603000';

  /** 仅更新元数据说明，不修改业务数据及既有索引、外键。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE schema_migrations COMMENT='数据库结构迁移执行记录',
      MODIFY id INT NOT NULL AUTO_INCREMENT COMMENT '迁移记录自增编号',
      MODIFY timestamp BIGINT NOT NULL COMMENT '迁移定义时间戳（毫秒）',
      MODIFY name VARCHAR(255) NOT NULL COMMENT '已执行迁移名称'`);
    await runner.query(`ALTER TABLE platform_metadata COMMENT='平台工程基线元数据',
      MODIFY metadata_key VARCHAR(64) NOT NULL COMMENT '元数据唯一键',
      MODIFY metadata_value VARCHAR(255) NOT NULL COMMENT '元数据值',
      MODIFY created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）'`);
    await runner.query(`ALTER TABLE accounts COMMENT='用户账号及当前团队归属',
      MODIFY id CHAR(36) NOT NULL COMMENT '账号唯一标识',
      MODIFY login_name VARCHAR(64) NOT NULL COMMENT '登录名，全局唯一',
      MODIFY display_name VARCHAR(100) NOT NULL COMMENT '用户显示姓名',
      MODIFY password_hash VARCHAR(255) NOT NULL COMMENT '加盐密码派生值，不存储明文密码',
      MODIFY is_super_admin TINYINT NOT NULL DEFAULT 0 COMMENT '是否为超级管理员：零否，一是',
      MODIFY disabled TINYINT NOT NULL DEFAULT 0 COMMENT '是否停用：零启用，一停用',
      MODIFY must_change_password TINYINT NOT NULL DEFAULT 1 COMMENT '是否必须修改密码：零否，一是',
      MODIFY version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '账号版本号，用于并发冲突检查',
      MODIFY created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）',
      MODIFY updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
      MODIFY team_id CHAR(36) NULL COMMENT '当前所属团队标识，空表示未加入团队'`);
    await runner.query(`ALTER TABLE login_sessions COMMENT='登录会话及跨站请求校验信息',
      MODIFY token_hash CHAR(64) NOT NULL COMMENT '会话令牌摘要，不存储原始令牌',
      MODIFY account_id CHAR(36) NOT NULL COMMENT '所属账号标识',
      MODIFY csrf_token CHAR(64) NOT NULL COMMENT '跨站请求伪造防护校验值',
      MODIFY created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）',
      MODIFY expires_at DATETIME(3) NOT NULL COMMENT '失效时间（协调世界时）'`);
    await runner.query(`ALTER TABLE authentication_limits COMMENT='认证请求频率限制',
      MODIFY bucket_hash CHAR(64) NOT NULL COMMENT '请求来源限流分桶摘要',
      MODIFY failures INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前窗口已消耗认证尝试次数，包含成功尝试',
      MODIFY window_start DATETIME(3) NOT NULL COMMENT '计数窗口起始时间（协调世界时）'`);
    await runner.query(`ALTER TABLE audit_events COMMENT='账号与组织操作审计记录',
      MODIFY id CHAR(36) NOT NULL COMMENT '审计事件唯一标识',
      MODIFY actor_id CHAR(36) NOT NULL COMMENT '操作账号标识',
      MODIFY action VARCHAR(64) NOT NULL COMMENT '操作类型编码',
      MODIFY subject_id CHAR(36) NOT NULL COMMENT '被审计对象标识',
      MODIFY created_at DATETIME(3) NOT NULL COMMENT '操作时间（协调世界时）'`);
    await runner.query(`ALTER TABLE teams COMMENT='团队及团队负责人',
      MODIFY id CHAR(36) NOT NULL COMMENT '团队唯一标识',
      MODIFY name VARCHAR(100) NOT NULL COMMENT '团队名称',
      MODIFY leader_id CHAR(36) NOT NULL COMMENT '团队负责人账号标识',
      MODIFY version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '团队版本号，用于并发冲突检查',
      MODIFY created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）'`);
    await runner.query(`ALTER TABLE work_groups COMMENT='团队工作小组',
      MODIFY id CHAR(36) NOT NULL COMMENT '小组唯一标识',
      MODIFY team_id CHAR(36) NOT NULL COMMENT '所属团队标识',
      MODIFY name VARCHAR(100) NOT NULL COMMENT '小组名称',
      MODIFY leader_id CHAR(36) NOT NULL COMMENT '组长账号标识，须为本组成员',
      MODIFY version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '小组版本号，用于并发冲突检查'`);
    await runner.query(`ALTER TABLE group_members COMMENT='小组成员关系，同一账号可加入多个小组',
      MODIFY group_id CHAR(36) NOT NULL COMMENT '所属小组标识',
      MODIFY account_id CHAR(36) NOT NULL COMMENT '成员账号标识，须属于小组所在团队'`);
    await runner.query(`ALTER TABLE projects COMMENT='团队项目',
      MODIFY id CHAR(36) NOT NULL COMMENT '项目唯一标识',
      MODIFY team_id CHAR(36) NOT NULL COMMENT '所属团队标识',
      MODIFY name VARCHAR(100) NOT NULL COMMENT '项目名称',
      MODIFY version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '项目版本号，用于成员及角色并发冲突检查'`);
    await runner.query(`ALTER TABLE project_members COMMENT='项目成员及兼任角色',
      MODIFY project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      MODIFY account_id CHAR(36) NOT NULL COMMENT '成员账号标识，须属于项目所在团队',
      MODIFY roles_json JSON NOT NULL COMMENT '项目角色编码数组，可兼任项目经理、项目负责人、开发人员'`);
    await runner.query(`ALTER TABLE role_policies COMMENT='预设角色的可配置权限策略',
      MODIFY role_name VARCHAR(40) NOT NULL COMMENT '预设角色唯一编码',
      MODIFY permissions_json JSON NOT NULL COMMENT '角色权限编码数组，不可突破固定业务边界',
      MODIFY version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '策略版本号，用于并发冲突检查'`);
  }

  /** 保留中文说明，不提供自动降级。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
