import type { MigrationInterface, QueryRunner } from 'typeorm';

/** V2 增量结构先于入口切换建立；不删除 V1 数据，不在此阶段猜测历史映射。 */
export class V2Foundation1792152000000 implements MigrationInterface {
  name = 'V2Foundation1792152000000';

  /** MySQL DDL 不可事务回滚，失败后须按迁移记录检查；旧表始终保留到转换验收。 */
  async up(runner: QueryRunner): Promise<void> {
    const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    await runner.query(`CREATE TABLE v2_team_settings (
      team_id CHAR(36) NOT NULL PRIMARY KEY COMMENT '所属团队标识',
      message VARCHAR(500) NOT NULL DEFAULT '' COMMENT '我的工作团队文案，空或空白不展示',
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai' COMMENT '业务日期时区，当前固定上海',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '配置及区间目录并发版本',
      FOREIGN KEY (team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='新版团队配置及日期目录事务锁'`);

    await runner.query(`CREATE TABLE v2_periods (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '日期区间唯一标识',
      team_id CHAR(36) NOT NULL COMMENT '所属团队标识',
      start_on DATE NOT NULL COMMENT '包含在区间内的开始日期，团队时区',
      end_on DATE NOT NULL COMMENT '包含在区间内的结束日期，团队时区',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '日期边界并发版本',
      UNIQUE KEY uq_v2_period_start(team_id,start_on), UNIQUE KEY uq_v2_period_team(id,team_id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='团队连续无重叠日期区间，历史边界锁定由服务校验'`);

    await runner.query(`CREATE TABLE v2_milestones (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '独立里程碑标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      owner_id CHAR(36) NOT NULL COMMENT '责任归属用于项目成员移出检查，不限制其他研发负责人确认',
      title VARCHAR(200) NOT NULL COMMENT '阶段目标名称',
      expected_on DATE NULL COMMENT '预计完成日期，空为未规划节点',
      status VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT '目标状态：open未完成、completed已确认',
      needs_review TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '完成后关联任务回退产生的待核验提示',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '里程碑并发版本',
      deleted_at DATETIME(3) NULL COMMENT '移出当前规划的时间，历史继续保留',
      created_at DATETIME(3) NOT NULL COMMENT '创建时间，协调世界时',
      updated_at DATETIME(3) NOT NULL COMMENT '修改时间，协调世界时',
      UNIQUE KEY uq_v2_milestone_project(id,project_id), KEY idx_v2_milestone_date(project_id,expected_on),
      FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='新版独立里程碑及完成后的核验标记'`);

    await runner.query(`CREATE TABLE v2_tasks (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '所有入口共用的任务标识',
      kind VARCHAR(16) NOT NULL COMMENT 'project项目任务或private私人任务',
      team_id CHAR(36) NULL COMMENT '项目任务所属团队，私人任务为空',
      project_id CHAR(36) NULL COMMENT '项目任务所属项目，私人任务为空',
      creator_id CHAR(36) NOT NULL COMMENT '原创建人，待建转换后保持不变',
      executor_id CHAR(36) NOT NULL COMMENT '唯一执行人，私人任务即唯一所有者',
      milestone_id CHAR(36) NULL COMMENT '可选的同项目里程碑，私人任务为空',
      title VARCHAR(200) NOT NULL COMMENT '任务名称，不设置说明或检查清单',
      priority TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '优先级一至五，数值越小越高',
      status VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT '执行状态：not_started未开始、in_progress进行中、completed已完成',
      completed_at DATETIME(3) NULL COMMENT '本次实际完成时间，回退清空而历史事件不删除',
      history_known_from DATETIME(3) NOT NULL COMMENT '完整状态历史的最早可信时刻，之前不可用当前状态补造',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '任务及安排聚合并发版本',
      deleted_at DATETIME(3) NULL COMMENT '从当前任务及安排移出的时间，必要历史保留',
      created_at DATETIME(3) NOT NULL COMMENT '原创建时间，协调世界时',
      updated_at DATETIME(3) NOT NULL COMMENT '修改时间，协调世界时',
      UNIQUE KEY uq_v2_task_team(id,team_id), KEY idx_v2_task_executor(executor_id,status,deleted_at), KEY idx_v2_task_project(project_id,status),
      FOREIGN KEY(team_id) REFERENCES teams(id), FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(creator_id) REFERENCES accounts(id), FOREIGN KEY(executor_id) REFERENCES accounts(id),
      FOREIGN KEY(milestone_id,project_id) REFERENCES v2_milestones(id,project_id)
    ) ${suffix} COMMENT='新版单执行人项目任务及仅本人可见私人任务'`);

    await runner.query(`CREATE TABLE v2_task_events (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '不可变任务事件标识',
      task_id CHAR(36) NOT NULL COMMENT '来源任务标识，逻辑删除后继续保留',
      sequence INT UNSIGNED NOT NULL COMMENT '任务聚合版本，打破相同毫秒事件顺序',
      actor_id CHAR(36) NOT NULL COMMENT '实际操作者，代改不伪装为执行人',
      action VARCHAR(32) NOT NULL COMMENT '创建、修改、状态变化、删除或迁移的事件编码',
      before_status VARCHAR(24) NULL COMMENT '变化前状态，创建或无历史基线时为空',
      snapshot_json JSON NOT NULL COMMENT '当时任务业务快照，私人事件仅本人可见',
      occurred_at DATETIME(3) NOT NULL COMMENT '事实发生时间，协调世界时，迁移不得伪造',
      UNIQUE KEY uq_v2_task_event(task_id,sequence), KEY idx_v2_task_event_time(task_id,occurred_at),
      FOREIGN KEY(task_id) REFERENCES v2_tasks(id), FOREIGN KEY(actor_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='新版任务状态与执行人历史，支撑区间末回看'`);

    await runner.query(`CREATE TABLE v2_arrangements (
      task_id CHAR(36) NOT NULL COMMENT '同一项目任务标识',
      period_id CHAR(36) NOT NULL COMMENT '本次安排日期区间',
      team_id CHAR(36) NOT NULL COMMENT '任务和日期区间共用的团队，外键阻止跨团队安排',
      planned_days DECIMAL(6,2) NULL COMMENT '本区间预计投入天数，空为未估算，不是零',
      position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '区间内项目任务共享顺序',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '安排并发版本，与任务聚合版本共同校验',
      PRIMARY KEY(task_id,period_id),
      FOREIGN KEY(task_id,team_id) REFERENCES v2_tasks(id,team_id), FOREIGN KEY(period_id,team_id) REFERENCES v2_periods(id,team_id)
    ) ${suffix} COMMENT='当前有效区间安排，正式任务至少一个由事务服务保证'`);

    await runner.query(`CREATE TABLE v2_arrangement_history (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '安排有效时间片标识',
      task_id CHAR(36) NOT NULL COMMENT '安排的项目任务标识',
      period_id CHAR(36) NOT NULL COMMENT '原安排区间标识',
      actor_id CHAR(36) NOT NULL COMMENT '加入或修改安排的实际操作者',
      planned_days DECIMAL(6,2) NULL COMMENT '该时间片的预计投入，不从后续安排覆盖',
      provenance VARCHAR(32) NOT NULL COMMENT 'scheduled真实安排或migration_supplement迁移补录',
      valid_from DATETIME(3) NOT NULL COMMENT '安排生效时刻，协调世界时',
      valid_until DATETIME(3) NULL COMMENT '安排失效时刻，空表示仍生效，撤销后再加入创建新片段',
      KEY idx_v2_arrangement_history(period_id,task_id,valid_from),
      FOREIGN KEY(task_id) REFERENCES v2_tasks(id), FOREIGN KEY(period_id) REFERENCES v2_periods(id), FOREIGN KEY(actor_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='安排历史及计划外判断依据，取消关系不抹除旧事实'`);

    await runner.query(`CREATE TABLE v2_backlog (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '待建任务标识',
      project_id CHAR(36) NOT NULL COMMENT '所属项目标识',
      creator_id CHAR(36) NOT NULL COMMENT '原创建人，转换为任务时继承',
      title VARCHAR(200) NOT NULL COMMENT '事项名称',
      priority TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '优先级一至五，默认三',
      converted_task_id CHAR(36) NULL COMMENT '转换后的唯一任务，用于防止重复转换',
      converted_by CHAR(36) NULL COMMENT '转换实际操作者，不覆盖创建人',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '待建任务并发版本',
      deleted_at DATETIME(3) NULL COMMENT '删除时间，保留必要来源历史',
      created_at DATETIME(3) NOT NULL COMMENT '原创建时间，协调世界时',
      UNIQUE KEY uq_v2_backlog_task(converted_task_id),
      FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(creator_id) REFERENCES accounts(id),
      FOREIGN KEY(converted_task_id) REFERENCES v2_tasks(id), FOREIGN KEY(converted_by) REFERENCES accounts(id)
    ) ${suffix} COMMENT='无审批流程的待建任务及转换幂等关联'`);

    await runner.query(`CREATE TABLE v2_categories (
      id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人分类标识',
      owner_id CHAR(36) NOT NULL COMMENT '分类所有人账号',
      name VARCHAR(100) NOT NULL COMMENT '同一人不可重名的分类名称',
      status VARCHAR(24) NOT NULL COMMENT '对应执行状态，创建后只允许改名而不能改状态',
      is_default TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否本状态唯一默认分类',
      default_status VARCHAR(24) GENERATED ALWAYS AS (CASE WHEN is_default=1 THEN status ELSE NULL END) STORED COMMENT '默认状态唯一键，非默认分类为空',
      position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '分类显示顺序',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '分类并发版本',
      UNIQUE KEY uq_v2_category_owner(id,owner_id), UNIQUE KEY uq_v2_category_name(owner_id,name), UNIQUE KEY uq_v2_category_default(owner_id,default_status),
      FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='个人执行状态分类，每状态至少一个默认由事务服务保证'`);

    await runner.query(`CREATE TABLE v2_personal_views (
      owner_id CHAR(36) NOT NULL PRIMARY KEY COMMENT '个人看板所有人，用于串行化分类和顺序修改',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '完整个人看板版本，筛选后的列表不能覆盖全量',
      FOREIGN KEY(owner_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='个人视图版本，不与团队共享排序混用'`);
    await runner.query(`CREATE TABLE v2_placements (
      task_id CHAR(36) NOT NULL PRIMARY KEY COMMENT '本人执行的原任务，不复制成个人任务',
      owner_id CHAR(36) NOT NULL COMMENT '当前视图所有人，须等于任务执行人',
      category_id CHAR(36) NOT NULL COMMENT '同一人的目标分类，状态由服务校验',
      position INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '个人分类内顺序，和团队排序独立',
      FOREIGN KEY(task_id) REFERENCES v2_tasks(id), FOREIGN KEY(category_id,owner_id) REFERENCES v2_categories(id,owner_id)
    ) ${suffix} COMMENT='项目和私人任务的个人分类位置'`);

    await runner.query(`CREATE TABLE v2_shared_orders (
      team_id CHAR(36) NOT NULL COMMENT '共享排序所属团队',
      scope_key VARCHAR(120) NOT NULL COMMENT '项目组或项目区间的固定排序作用域键',
      ordered_ids JSON NOT NULL COMMENT '作用域内完整对象顺序，不保存受限视图子集',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '多人排序冲突版本',
      PRIMARY KEY(team_id,scope_key), FOREIGN KEY(team_id) REFERENCES teams(id)
    ) ${suffix} COMMENT='团队共享项目和区间任务排序版本'`);

    await runner.query(`CREATE TABLE v2_report_texts (
      team_id CHAR(36) NOT NULL COMMENT '共享文字所属团队，只有团队负责人读取维护整稿',
      summary_period_id CHAR(36) NOT NULL COMMENT '总结区间标识',
      plan_period_id CHAR(36) NOT NULL COMMENT '计划区间标识',
      body MEDIUMTEXT NOT NULL COMMENT '当前显示文字，手工文字不自动覆盖',
      manual TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否人工编辑，自动稿随来源更新',
      source_hash CHAR(64) NOT NULL COMMENT '编辑或确认时的来源摘要，变化后提示未同步',
      version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '多人编辑版本',
      updated_by CHAR(36) NOT NULL COMMENT '最近保存文字的实际操作者',
      updated_at DATETIME(3) NOT NULL COMMENT '保存时间，协调世界时',
      PRIMARY KEY(team_id,summary_period_id,plan_period_id),
      FOREIGN KEY(summary_period_id,team_id) REFERENCES v2_periods(id,team_id), FOREIGN KEY(plan_period_id,team_id) REFERENCES v2_periods(id,team_id), FOREIGN KEY(updated_by) REFERENCES accounts(id)
    ) ${suffix} COMMENT='按团队及两个区间组合保护的共享文字稿'`);

    await runner.query(`CREATE TABLE v2_operations (
      actor_id CHAR(36) NOT NULL COMMENT '实际请求人',
      operation_id CHAR(36) NOT NULL COMMENT '客户端幂等操作标识',
      payload_hash CHAR(64) NOT NULL COMMENT '操作内容摘要，同键不同内容拒绝',
      result_json JSON NOT NULL COMMENT '已成功操作的最小响应，不存凭据',
      created_at DATETIME(3) NOT NULL COMMENT '提交时间，协调世界时',
      PRIMARY KEY(actor_id,operation_id), FOREIGN KEY(actor_id) REFERENCES accounts(id)
    ) ${suffix} COMMENT='新版成功写入幂等记录，不复用旧命令'`);

    await runner.query(`CREATE TABLE v2_migration_map (
      source_table VARCHAR(64) NOT NULL COMMENT '旧对象来源表名，仅接受迁移固定清单',
      source_id CHAR(36) NOT NULL COMMENT '旧对象业务标识',
      target_kind VARCHAR(32) NOT NULL COMMENT '新版任务、待建、里程碑或保留历史的类型',
      target_id CHAR(36) NOT NULL COMMENT '新对象标识，一对多保留多条映射',
      decision VARCHAR(200) NOT NULL COMMENT '保留、拆分、补充区间等迁移决定及来源，不记录私人内容',
      migrated_at DATETIME(3) NOT NULL COMMENT '实际迁移时间，不当作旧业务发生时间',
      PRIMARY KEY(source_table,source_id,target_kind,target_id)
    ) ${suffix} COMMENT='旧新对象对账及可重复迁移依据'`);
  }

  /** 用户数据产生后禁止自动删表降级；恢复以完整备份及应用版本为单位。 */
  async down(): Promise<void> { throw new Error('V2 recovery requires the verified full backup; automatic table removal is disabled'); }
}
