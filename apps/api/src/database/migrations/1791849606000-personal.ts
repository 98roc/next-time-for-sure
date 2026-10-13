import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 个人工作、私人事项及个人分类独立保存，私人内容不进入团队历史。 */
export class Personal1791849606000 implements MigrationInterface {
  name = 'Personal1791849606000';
  /** 使用明确中文注释及外键，关联分工不复制执行事实。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE personal_categories (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人分类唯一标识',
      owner_id CHAR(36) NOT NULL COMMENT '分类所属账号，仅本人管理',
      name VARCHAR(200) NOT NULL COMMENT '分类名称，不表达执行状态',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '分类并发版本号',
      CONSTRAINT fk_category_owner FOREIGN KEY (owner_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人空间自定义分类'`);
    await runner.query(`CREATE TABLE personal_items (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人事项唯一标识',
      owner_id CHAR(36) NOT NULL COMMENT '所属账号，内容和执行事实仅本人修改',
      kind VARCHAR(16) NOT NULL COMMENT '事项类型编码：工作或私人，私人仅本人可见',
      project_id CHAR(36) NULL COMMENT '工作所属项目，私人事项为空',
      assignment_id CHAR(36) NULL COMMENT '关联本人团队分工，独立工作和私人事项为空',
      title VARCHAR(200) NOT NULL COMMENT '个人事项标题',
      description TEXT NOT NULL COMMENT '个人说明，允许为空',
      acceptance TEXT NOT NULL COMMENT '个人完成标准，允许为空',
      status VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT '本人执行状态编码：待开始、进行中、完成',
      checklist_json JSON NOT NULL COMMENT '一层检查清单，仅保存内容及勾选结果',
      category_id CHAR(36) NULL COMMENT '本人分类标识，空为未分类',
      position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '分类内个人排序位置，不改变执行状态',
      planned_on DATE NULL COMMENT '本人计划日期，不构成团队交付承诺',
      blocked_reason TEXT NOT NULL COMMENT '阻塞说明，空表示未标记阻塞',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '个人事项并发版本号',
      started_at DATETIME(3) NULL COMMENT '本人实际开始时间（协调世界时）',
      ended_at DATETIME(3) NULL COMMENT '本人实际结束时间（协调世界时）',
      created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
      CONSTRAINT fk_personal_owner FOREIGN KEY (owner_id) REFERENCES accounts(id),
      CONSTRAINT fk_personal_project FOREIGN KEY (project_id) REFERENCES projects(id),
      CONSTRAINT fk_personal_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments(id),
      CONSTRAINT fk_personal_category FOREIGN KEY (category_id) REFERENCES personal_categories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人工作任务及严格隔离的私人事项'`);
    await runner.query(`CREATE TABLE personal_progress (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人进展唯一标识',
      item_id CHAR(36) NOT NULL COMMENT '来源个人事项标识，用于权限和归集去重',
      occurred_on DATE NOT NULL COMMENT '实际发生日期',
      report_week DATE NOT NULL COMMENT '汇报归属周的周一日期，独立于发生日期',
      content TEXT NOT NULL COMMENT '逐条进展内容，私人进展不对团队开放',
      created_at DATETIME(3) NOT NULL COMMENT '记录创建时间（协调世界时）',
      CONSTRAINT fk_personal_progress FOREIGN KEY (item_id) REFERENCES personal_items(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人事项进展及汇报归属'`);
    await runner.query(`CREATE TABLE personal_events (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人事项历史唯一标识',
      owner_id CHAR(36) NOT NULL COMMENT '历史所属账号，私人历史仅本人可见',
      object_id CHAR(36) NOT NULL COMMENT '个人事项或分类标识',
      action VARCHAR(64) NOT NULL COMMENT '操作编码',
      payload_json JSON NOT NULL COMMENT '个人内容变更快照，不进入团队侧审计详情',
      created_at DATETIME(3) NOT NULL COMMENT '操作时间（协调世界时）',
      KEY idx_personal_history (owner_id, object_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='隔离保存的个人事项及分类历史'`);
  }
  /** 不自动删除个人执行及历史记录。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
