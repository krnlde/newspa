/**
 * `newspa-db`: schema, migrations, the single-instance claim, repositories.
 *
 * The package owns I/O and nothing else — no HTTP, no scheduler, no parsing
 * (docs/architecture.md's module table). Records are the contract: the shapes
 * in and out are `newspa-core`'s and `newspa-config`'s, and where a column has
 * no place in a core record (`snapshots.outcome`, `items.section`) the module
 * that owns the column says so.
 */

export type { HtmlSource, JsonSource, RssSource, SourceSpec } from 'newspa-config';
// The record types the repositories speak in, re-exported so a caller of this
// package needs one import to type a row.
export type {
  EditReport,
  ErrorKind,
  EventKind,
  HealthState,
  ItemEventRecord,
  ItemRecord,
  PickedItem,
  SourceKind,
} from 'newspa-core';
export type { ClaimOptions, Database, OpenOptions } from './database.ts';
export {
  DatabaseLockedError,
  DEFAULT_BUSY_TIMEOUT_MS,
  DEFAULT_LOCK_STALE_MS,
  extendClaim,
  openDatabase,
  openInMemory,
} from './database.ts';
export type { ConnectionLike, DatabaseLike, Driver, DriverOptions, StatementLike } from './driver.ts';
export {
  DEFAULT_EVENT_LIMIT,
  type EventListQuery,
  ItemEventError,
  type ItemEventsRepository,
  itemEventsRepository,
  MAX_EVENT_LIMIT,
  type NewItemEvent,
} from './itemEvents.ts';
export {
  DEFAULT_ITEM_LIMIT,
  type ItemFilter,
  ItemKeyError,
  type ItemListQuery,
  type ItemRead,
  type ItemsRepository,
  type ItemWrite,
  itemsRepository,
  itemWriteOf,
  MAX_ITEM_LIMIT,
} from './items.ts';
export {
  itemsStreaksRepository,
  type StoredKeyRow,
  type StreakMembers,
  type StreakWrite,
} from './itemsStreaks.ts';
export {
  claimLock,
  extendLock,
  LOCK_TABLE_SQL,
  LockNotHeldError,
  type LockOptions,
  type LockOwner,
  type LockResult,
  type LockState,
  readLock,
  releaseLock,
} from './lock.ts';
export {
  type AppliedMigration,
  appliedOf,
  FutureVersionError,
  MIGRATIONS_TABLE,
  type MigrateOptions,
  MigrationFailedError,
  migrate,
  versionOf,
} from './migrations.ts';
export { narrowRow, narrowRunResult, sqliteDriver } from './nodeDriver.ts';
export {
  CHECK_ERROR_KINDS,
  CHECK_EVENT_KINDS,
  CHECK_HEALTH_STATES,
  CHECK_KINDS,
  CURRENT_VERSION,
  MAX_MIGRATION_VERSION,
  MIGRATIONS,
  type Migration,
  SNAPSHOT_OUTCOMES,
} from './schema.ts';
export {
  DEFAULT_SNAPSHOT_LIMIT,
  MAX_SNAPSHOT_LIMIT,
  type PollSnapshot,
  SnapshotError,
  type SnapshotListOptions,
  type SnapshotOutcome,
  type SnapshotRepository,
  type SnapshotRow,
  snapshotsRepository,
} from './snapshots.ts';
export {
  type SourceHealthPatch,
  SourceKeyError,
  type SourceListOptions,
  type SourcesRepository,
  type StoredSource,
  sourcesRepository,
} from './sources.ts';
export { type Statements, statementsOf, type Tx } from './statement.ts';
export { parseTimeSpec, type SourceTimeSpec, TimeSpecError, timeSpecOf } from './timeSpec.ts';
export {
  EMPTY_CACHE_HINTS,
  emptyValidatorState,
  type ValidatorOutcome,
  type ValidatorRead,
  type ValidatorRepository,
  type ValidatorRow,
  validatorRepository,
} from './validators.ts';
export {
  decodeBoolean,
  decodeCount,
  decodeCounts,
  decodeInteger,
  decodeJson,
  decodeJsonColumn,
  decodeOptionalInteger,
  decodeOptionalText,
  decodeReal,
  decodeText,
  decodeTextOf,
  encodeBoolean,
  encodeJson,
  encodeJsonColumn,
  JSON_COLUMNS,
  type JsonColumn,
  type Row,
  RowShapeError,
  type RunResult,
  type SourceCount,
  type SqlValue,
  type ValidatorState,
} from './value.ts';
