/**
 * The migration history, and the head: `MIGRATIONS` in order, with
 * `CURRENT_VERSION` as its last entry, and the statements that take a file from
 * one `user_version` to the next.
 *
 * `schema.ts` keeps the base DDL and the CHECK vocabulary it is written with,
 * and every migration that grew after it is here — the split is rule 1's
 * 300-line cap, and the seam is a real one: migration 1 is the schema a fresh
 * database starts from, migrations 2..5 are the state the paper learned to need.
 *
 * The import runs **one way**: this module reads `MIGRATION_1` and the CHECK
 * constants from `schema.ts`, and `schema.ts` imports nothing from here. A cycle
 * is not a style question: measured, `schema.ts` ⇄ `migrationHistory.ts` left
 * the other module's constants **uninitialised** while a template literal was
 * interpolating them, and the DDL reached SQLite as `json_type (undefined)` —
 * `migration 2 (validator-state) failed: near "undefined": syntax error`.
 *
 * Each entry is a list of statements `migrate()` runs inside one transaction
 * (`migrations.ts`), so a migration that fails halfway leaves the version where
 * it was. `alter table … add column` **appends** to the row: a repository that
 * binds by position, and every test that pins a column list, depends on that.
 */
import {
  CACHE_JSON_CHECK,
  ERROR_KIND_CHECK,
  MIGRATION_1,
  type Migration,
  OUTCOME_CHECK_V3,
  VARY_JSON_CHECK,
} from './schema.ts';

/*
 * The change-detection state, in its own table because a source row is a
 * one-way copy from `sources/*.json` (D-011) and this state is written on
 * every poll: keeping them apart is what makes the write one statement, the
 * counters readable by a health note, and a bad validator a `validators()`
 * result instead of a poisoned source row.
 *
 * The JSON checks are a conjunction of `json_valid` and `json_type`, measured
 * on this SQLite: the array-only predicate SQLite once shipped is not present
 * (`no such function`), and a bare type comparison lets invalid JSON through,
 * because a check passes when its expression is null.
 */
export const MIGRATION_2 = [
  `create table source_validators (
    source_id text primary key,
    etag text,
    last_modified text,
    response_date text,
    cache_json text not null ${CACHE_JSON_CHECK},
    vary_json text not null ${VARY_JSON_CHECK},
    weak_etag integer not null,
    body_hash text,
    declared_modified_at text,
    generator text,
    freshness_seconds integer,
    ttl_minutes integer,
    no_cache_meta integer not null,
    fast_path_hits integer not null default 0,
    fast_path_misses integer not null default 0,
    foreign key (source_id) references sources (id) on delete cascade
  )`,
];

/*
 * The selection rung (D-027): the third rung's state, and the outcome name it
 * writes.
 *
 * `selection_hash` is the hash of the **selected node's** normalized text. A
 * page-mode source leaves it `null`: there the page is the whole selection, and
 * rung 2's bytes hash is strictly stronger for "nothing moved".
 *
 * `snapshots` is **rebuilt**, not altered — SQLite cannot change a `check`, and
 * the widened list is where the new rung's name lives. The copy keeps every
 * `id`, so a snapshot's position in the paper's history does not move; the index
 * is recreated because `drop table` takes it with the table. The table being
 * dropped is the *child* of `sources`, so this needs no `defer_foreign_keys`.
 */
export const MIGRATION_3 = [
  'alter table source_validators add column selection_hash text',
  `create table snapshots_v3 (
    id integer primary key autoincrement,
    source_id text not null,
    taken_at text not null,
    outcome text not null ${OUTCOME_CHECK_V3},
    status integer not null,
    bytes integer not null,
    duration_ms integer,
    item_count integer,
    error_kind text ${ERROR_KIND_CHECK},
    note text,
    foreign key (source_id) references sources (id) on delete cascade
  )`,
  `insert into snapshots_v3 (id, source_id, taken_at, outcome, status, bytes, duration_ms, item_count, error_kind, note)
     select id, source_id, taken_at, outcome, status, bytes, duration_ms, item_count, error_kind, note from snapshots`,
  'drop table snapshots',
  'alter table snapshots_v3 rename to snapshots',
  'create index snapshots_source on snapshots (source_id, taken_at desc, id desc)',
];

/*
 * The disappearance ladder (D-029, level 1): the two columns core's
 * `goneVerdicts` moves, stored **beside the item** because a disappearance is a
 * property of one key. A side table would be a join per verdict, and the ladder
 * reads a source's whole key set on every poll.
 *
 *  - `missing_streak` — the polls, complete and successful, that did **not**
 *    list this key. `0` is the ladder's "never missed".
 *  - `gone_at` — the instant the paper said so, and `null` while the key is on
 *    the list. Writing `null` is the reopen arm of the ladder, so no CHECK
 *    belongs on this column.
 *
 * `not null default 0` is what makes a row written before this migration
 * correct rather than unknown: nothing had been counted against it, so its
 * streak is zero and it takes K absent polls before the paper says anything.
 * Measured on this SQLite: `alter table … add column` appends to a `without
 * rowid` table, fills every existing row with the default, and
 * `integrity_check` is `ok` afterwards.
 */
export const MIGRATION_4 = [
  'alter table items add column missing_streak integer not null default 0',
  'alter table items add column gone_at text',
];

/*
 * The scheduler's countdown (roadmap: "bounded batches, not all at once"), on
 * `sources` because it is per-source and every tick reads it:
 *
 *  - `next_run_at` — the instant this source may be polled again, and `null`
 *    means "never scheduled, run it first": a fresh database has a row per
 *    source and has to poll all of them, so `dueSources` sorts a null **first**.
 *  - `consecutive_failures` — the streak a backoff multiplies. `not null
 *    default 0` makes every row written before this migration "no failures
 *    recorded", which is the truth, so there is nothing to backfill.
 *
 * Neither column is in `StoredSource`, and `insert`/`upsert` do not name them:
 * the read side (`packages/server/src/state.ts`'s `SourceHealthView`) has no
 * field for a countdown, and re-importing a source the scheduler is watching
 * must not reset its own countdown. `setSchedule` in `sourcesScheduling.ts` is
 * the only writer.
 *
 * `alter table … add column` appends, fills existing rows with the default and
 * leaves `integrity_check` `ok` — measured for migration 4, the same shape — so
 * migration 1's `create table sources` is **not** touched: a fresh database
 * runs all five, and a base DDL that differs from a migrated one is how a
 * corpus stops proving the migration path.
 */
export const MIGRATION_5 = [
  'alter table sources add column next_run_at text',
  'alter table sources add column consecutive_failures integer not null default 0',
];

/**
 * The list, in order: adding an entry here is the only way to move the head, and
 * `CURRENT_VERSION` follows from it, so a test never pins a version literal.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'base', statements: MIGRATION_1 },
  { version: 2, name: 'validator-state', statements: MIGRATION_2 },
  { version: 3, name: 'selection-rung', statements: MIGRATION_3 },
  { version: 4, name: 'disappearance', statements: MIGRATION_4 },
  { version: 5, name: 'scheduling', statements: MIGRATION_5 },
];

export const CURRENT_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
