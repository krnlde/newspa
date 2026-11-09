/**
 * `user_version` migrations, forward-only, one transaction each.
 *
 * Measured: `PRAGMA user_version = 4` writes and `pragma user_version` reads
 * (there is no `user_version` column in SQL — `select user_version` is a
 * `no such column` error), and the value arrives as a JS number.
 *
 * A database whose version is ahead of this build is refused, not downgraded:
 * forward-only means an unknown version has no known DDL, and silently writing
 * into it is how a corpus gets corrupted. The audit table is written in the
 * same transaction as the `user_version` bump, so it cannot drift, and a
 * migration whose statement fails is rolled back with the version unchanged —
 * which is why the fixture's row counts stay verifiable.
 */
import { MAX_MIGRATION_VERSION, MIGRATIONS, type Migration } from './schema.ts';
import type { Tx } from './statement.ts';
import { decodeCount, decodeText, RowShapeError } from './value.ts';

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string;
}

export interface MigrateOptions {
  /** Injected clock: the audit timestamp must be deterministic in tests. */
  readonly now: () => Date;
  /** Versions to run, in order. Defaults to the package's own list. */
  readonly migrations?: readonly Migration[];
}

export class FutureVersionError extends Error {
  readonly found: number;
  readonly head: number;

  constructor(found: number, head: number) {
    super(
      `database is at version ${found}, this build knows ${head}: forward-only migrations cannot open a newer database`,
    );
    this.name = 'FutureVersionError';
    this.found = found;
    this.head = head;
  }
}

export class MigrationFailedError extends Error {
  readonly version: number;
  readonly migrationName: string;

  constructor(version: number, migrationName: string, cause: unknown) {
    super(`migration ${version} (${migrationName}) failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'MigrationFailedError';
    this.version = version;
    this.migrationName = migrationName;
  }
}

export const MIGRATIONS_TABLE = `create table if not exists migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
)`;

export const versionOf = (db: Tx): number => decodeCount('user_version', db.get('pragma user_version'));

export const appliedOf = (db: Tx): AppliedMigration[] =>
  db.all('select version, name, applied_at from migrations order by version').map((row) => ({
    version: decodeCount('version', row),
    name: decodeText('name', 'a migration row', row['name']),
    appliedAt: decodeText('applied_at', 'a migration row', row['applied_at']),
  }));

/** Run every migration above the file's version. Returns the ones that ran. */
export const migrate = (db: Tx, options: MigrateOptions): AppliedMigration[] => {
  const migrations = options.migrations ?? MIGRATIONS;
  const head = migrations.at(-1)?.version ?? 0;
  const fileVersion = versionOf(db);
  if (fileVersion > MAX_MIGRATION_VERSION) throw new FutureVersionError(fileVersion, head);
  if (fileVersion > head) throw new FutureVersionError(fileVersion, head);
  db.exec(MIGRATIONS_TABLE);

  // A duplicate or out-of-order version is not cosmetic: the loop below skips
  // anything at or below the file's version, so a list like [1, 1, 2] silently
  // drops a migration and leaves the schema half-built. Fail loudly instead.
  let previous = 0;
  for (const migration of migrations) {
    if (migration.version <= previous) {
      throw new MigrationFailedError(
        migration.version,
        migration.name,
        new Error(`versions must be ascending: ${migration.version} follows ${previous}`),
      );
    }
    previous = migration.version;
  }

  const applied: AppliedMigration[] = [];
  for (const migration of migrations) {
    if (migration.version <= fileVersion) continue;
    const record: AppliedMigration = {
      version: migration.version,
      name: migration.name,
      appliedAt: options.now().toISOString(),
    };
    db.transaction(() => {
      try {
        for (const statement of migration.statements) db.exec(statement);
      } catch (cause) {
        throw new MigrationFailedError(migration.version, migration.name, cause);
      }
      db.run(
        'insert into migrations (version, name, applied_at) values (?, ?, ?)',
        record.version,
        record.name,
        record.appliedAt,
      );
      db.exec(`pragma user_version = ${record.version}`);
    });
    applied.push(record);
  }
  if (head > 0 && versionOf(db) !== head) {
    throw new RowShapeError('user_version', 'after migrating', `expected ${head}, got ${versionOf(db)}`);
  }
  return applied;
};
