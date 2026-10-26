import { TaskPeriodWork1792972800000 } from './migrations/1792972800000-task-period-work.js';
import { WeeklyProjectOrder1792713601000 } from './migrations/1792713601000-weekly-project-order.js';
import { RetireMilestoneOwner1792720800000 } from './migrations/1792720800000-retire-milestone-owner.js';
import { PersonalSubtasksDaily1792627201000 } from './migrations/1792627201000-personal-subtasks-daily.js';
import { V2Notifications1792454400000 } from './migrations/1792454400000-v2-notifications.js';
import { TaskEffort1792627200000 } from './migrations/1792627200000-task-effort.js';
import { TeamMessages1792368002000 } from './migrations/1792368002000-team-messages.js';
import { ProjectCreatedAt1792368001000 } from './migrations/1792368001000-project-created-at.js';
import { V2Sorting1792368000000 } from './migrations/1792368000000-v2-sorting.js';
import { V2ObjectEvents1792152002000 } from './migrations/1792152002000-v2-object-events.js';
import { V2RetireLegacy1792281600000 } from './migrations/1792281600000-v2-retire-legacy.js';
import { V2HistoryComment1792152001000 } from './migrations/1792152001000-v2-history-comment.js';
import { V2Foundation1792152000000 } from './migrations/1792152000000-v2-foundation.js';
import { PersonalWorkflow1792022401000 } from './migrations/1792022401000-personal-workflow.js';
import { TeamDirectAssignments1792022400000 } from './migrations/1792022400000-team-direct-assignments.js';
import { IndependentMilestones1791936000000 } from './migrations/1791936000000-independent-milestones.js';
import { PersonalTokens1791849615000 } from './migrations/1791849615000-personal-tokens.js';
import { LifecycleNotifications1791849614000 } from './migrations/1791849614000-lifecycle-notifications.js';
import { WeeklyPublications1791849613000 } from './migrations/1791849613000-weekly-publications.js';
import { WeeklyDrafts1791849612000 } from './migrations/1791849612000-weekly-drafts.js';
import { Blockers1791849611000 } from './migrations/1791849611000-blockers.js';
import { BoardOrder1791849610000 } from './migrations/1791849610000-board-order.js';
import { SplitOrigin1791849609000 } from './migrations/1791849609000-split-origin.js';
import { TaskLifecycle1791849608000 } from './migrations/1791849608000-task-lifecycle.js';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { Environment } from '../config/environment.js';
import { Foundation1791849600000 } from './migrations/1791849600000-foundation.js';
import { Identity1791849601000 } from './migrations/1791849601000-identity.js';
import { Organization1791849602000 } from './migrations/1791849602000-organization.js';
import { SchemaComments1791849603000 } from './migrations/1791849603000-schema-comments.js';
import { WorkIntake1791849604000 } from './migrations/1791849604000-work-intake.js';
import { Assignments1791849605000 } from './migrations/1791849605000-assignments.js';
import { Milestones1791849607000 } from './migrations/1791849607000-milestones.js';
import { Personal1791849606000 } from './migrations/1791849606000-personal.js';

/** 已知迁移顺序，用于只读就绪检查，避免检查过程创建迁移表。 */
export const requiredMigrationNames = ['Foundation1791849600000', 'Identity1791849601000', 'Organization1791849602000', 'SchemaComments1791849603000', 'WorkIntake1791849604000', 'Assignments1791849605000', 'Personal1791849606000', 'Milestones1791849607000', 'TaskLifecycle1791849608000', 'SplitOrigin1791849609000', 'BoardOrder1791849610000', 'Blockers1791849611000', 'WeeklyDrafts1791849612000', 'WeeklyPublications1791849613000', 'LifecycleNotifications1791849614000', 'PersonalTokens1791849615000', 'IndependentMilestones1791936000000', 'TeamDirectAssignments1792022400000', 'PersonalWorkflow1792022401000', 'V2Foundation1792152000000', 'V2HistoryComment1792152001000', 'V2ObjectEvents1792152002000', 'V2Sorting1792368000000', 'ProjectCreatedAt1792368001000', 'TeamMessages1792368002000', 'V2Notifications1792454400000', 'TaskEffort1792627200000', 'PersonalSubtasksDaily1792627201000', 'RetireMilestoneOwner1792720800000', 'WeeklyProjectOrder1792713601000', 'TaskPeriodWork1792972800000'];

/** API与迁移工具使用同一配置；关闭结构同步、自动迁移及SQL日志。 */
export function createDataSource(environment: Environment, includeCutover = false): DataSource {
  return new DataSource({
    type: 'mysql',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database: environment.DB_DATABASE,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'none',
    migrationsTableName: 'schema_migrations',
    migrations: [Foundation1791849600000, Identity1791849601000, Organization1791849602000, SchemaComments1791849603000, WorkIntake1791849604000, Assignments1791849605000, Personal1791849606000, Milestones1791849607000, TaskLifecycle1791849608000, SplitOrigin1791849609000, BoardOrder1791849610000, Blockers1791849611000, WeeklyDrafts1791849612000, WeeklyPublications1791849613000, LifecycleNotifications1791849614000, PersonalTokens1791849615000, IndependentMilestones1791936000000, TeamDirectAssignments1792022400000, PersonalWorkflow1792022401000, V2Foundation1792152000000, V2HistoryComment1792152001000, V2ObjectEvents1792152002000, V2Sorting1792368000000, ProjectCreatedAt1792368001000, TeamMessages1792368002000, V2Notifications1792454400000, TaskEffort1792627200000, PersonalSubtasksDaily1792627201000, RetireMilestoneOwner1792720800000, WeeklyProjectOrder1792713601000, TaskPeriodWork1792972800000, ...(includeCutover ? [V2RetireLegacy1792281600000] : [])],
    entities: [],
    logging: false,
    extra: { connectionLimit: 5, connectTimeout: 5000 },
  });
}
