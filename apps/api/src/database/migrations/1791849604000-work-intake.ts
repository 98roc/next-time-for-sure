import type { MigrationInterface, QueryRunner } from 'typeorm';

/** 第3阶段需求流转与任务接收；所有新表、字段在创建时直接写中文说明。 */
export class WorkIntake1791849604000 implements MigrationInterface {
  name = 'WorkIntake1791849604000';

  /** 需求、任务及历史独立持久化，接收关联以唯一键兜底幂等。 */
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE work_requests (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '需求唯一标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      submitter_id CHAR(36) NOT NULL COMMENT '需求提交人账号标识',
      title VARCHAR(200) NOT NULL COMMENT '需求标题',
      description TEXT NOT NULL COMMENT '需求说明，允许为空',
      acceptance TEXT NOT NULL COMMENT '完成标准，允许为空',
      status VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '处理状态：待处理、待补充、暂缓、拒绝、撤回、已接收的编码',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发编辑版本号',
      created_at DATETIME(3) NOT NULL COMMENT '提交时间（协调世界时）',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
      CONSTRAINT fk_request_project FOREIGN KEY (project_id) REFERENCES projects(id),
      CONSTRAINT fk_request_submitter FOREIGN KEY (submitter_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目需求及当前处理状态'`);
    await runner.query(`CREATE TABLE team_tasks (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '团队任务唯一标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      request_id CHAR(36) NULL COMMENT '来源需求标识，直接创建时为空',
      parent_id CHAR(36) NULL COMMENT '父任务标识，仅允许一层子任务',
      owner_id CHAR(36) NOT NULL COMMENT '任务主负责人账号标识，不等同于执行分工',
      title VARCHAR(200) NOT NULL COMMENT '任务标题',
      description TEXT NOT NULL COMMENT '任务说明，允许为空',
      acceptance TEXT NOT NULL COMMENT '完成标准，允许为空',
      status VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT '执行状态编码，待分配不作为执行状态',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '并发编辑版本号',
      created_at DATETIME(3) NOT NULL COMMENT '创建时间（协调世界时）',
      updated_at DATETIME(3) NOT NULL COMMENT '最后更新时间（协调世界时）',
      UNIQUE KEY uq_task_request (request_id),
      CONSTRAINT fk_task_project FOREIGN KEY (project_id) REFERENCES projects(id),
      CONSTRAINT fk_task_request FOREIGN KEY (request_id) REFERENCES work_requests(id),
      CONSTRAINT fk_task_parent FOREIGN KEY (parent_id) REFERENCES team_tasks(id),
      CONSTRAINT fk_task_owner FOREIGN KEY (owner_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队任务及来源需求关联'`);
    await runner.query(`CREATE TABLE work_events (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '历史事件唯一标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识，用于权限裁剪',
      object_id CHAR(36) NOT NULL COMMENT '需求或任务标识，历史不依赖对象仍存在',
      actor_id CHAR(36) NOT NULL COMMENT '操作人账号标识',
      action VARCHAR(64) NOT NULL COMMENT '业务操作编码',
      payload_json JSON NOT NULL COMMENT '操作内容及变更快照，不含认证凭据',
      created_at DATETIME(3) NOT NULL COMMENT '事件发生时间（协调世界时）',
      KEY idx_work_event_object (object_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求及团队任务变更历史'`);
    await runner.query(`CREATE TABLE work_operations (
      actor_id CHAR(36) NOT NULL COMMENT '操作人账号标识',
      operation_id CHAR(36) NOT NULL COMMENT '客户端生成的幂等操作标识',
      payload_hash CHAR(64) NOT NULL COMMENT '命令内容摘要，防止同键不同内容复用',
      object_id CHAR(36) NOT NULL COMMENT '本次操作产生或处理的对象标识',
      created_at DATETIME(3) NOT NULL COMMENT '操作提交时间（协调世界时）',
      PRIMARY KEY (actor_id, operation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成功写入操作幂等记录'`);
    // 仅为本阶段新增能力赋予需求约定的默认操作，不重置已配置的其他权限。
    for (const [role, permission] of [['team_leader', 'requests.submit'], ['project_manager', 'requests.submit'], ['team_leader', 'tasks.create'], ['project_lead', 'tasks.create'], ['developer', 'tasks.create']]) {
      await runner.query('UPDATE role_policies SET permissions_json = JSON_ARRAY_APPEND(permissions_json, \'$\', ?), version = version + 1 WHERE role_name = ?', [permission, role]);
    }
  }

  /** 历史与来源关系仅允许审查后的前向变更。 */
  async down(): Promise<void> { throw new Error('Use a reviewed forward migration'); }
}
