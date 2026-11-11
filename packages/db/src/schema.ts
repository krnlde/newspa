/**
 * The DDL, in one module, as forward-only migrations keyed by
 * `PRAGMA user_version`. Each migration is a list of statements that
 * `migrate()` runs inside one transaction, so a migration that fails halfway
 * leaves the version number where it was (measured: `exec` runs a script
 * verbatim, so the transaction is the only all-or-nothing boundary).
 *
 * Column sets come from the core record types, and where a column is **not**
 * in a core record that is stated:
 *  - `items.body` — D-017: the capped scrape is stored for edit detection and
 *    scoring, and `ItemView` has no `body`, so full text never reaches the browser.
 *  - `items.section` — the paper groups items by section; `ItemRecord` carries
 *    no section, so the value the server computed is kept DB-side to filter by.
 *  - `snapshots.outcome` — the change-detection ladder's name (docs/fetching.md);
 *    core's `FetchOutcome` is the numeric result, not the rung that ended the poll.
 *  - `items.missing_streak` / `items.gone_at` — the disappearance ladder's state
 *    (D-029). Core's `StoredKey` is the shape they are read in, and the write
 *    shape (`GoneVerdict`) is not a record, so neither column is in `ItemRecord`.
 *
 * Timestamps are UTC ISO strings produced by core. SQLite's strict tables are
 * available (measured: a text value in an integer column is rejected) but are
 * not used: real affinity accepts an integer binding as a float, which is what
 * a bound JS number is (measured: `typeof(:x)` is real).
 */
import type { ErrorKind, EventKind, HealthState, SourceKind } from 'newspa-core';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

const KIND_CHECK = `check (kind in ('rss', 'html', 'json'))`;
const EVENT_KIND_CHECK = `check (kind in ('new', 'edited', 'gone'))`;
const HEALTH_CHECK = `check (health in ('unknown', 'ok', 'blocked', 'no-matches', 'restructured', 'error', 'stale'))`;
const OUTCOME_CHECK = `check (outcome in ('not-modified', 'same-body', 'declared-unchanged', 'changed', 'error'))`;
/**
 * The widened list, installed by migration 3 (the selection rung, D-027).
 * `declared-unchanged` **stays**: a CHECK is a rule for inserts, not a statement
 * about what the ladder does today, and a schema that refuses the paper's own
 * history is how a corpus fails to restore.
 */
const OUTCOME_CHECK_V3 = `check (outcome in ('not-modified', 'same-body', 'declared-unchanged', 'selection-unchanged', 'changed', 'error'))`;
const ERROR_KIND_CHECK = `check (error_kind is null or error_kind in ('network', 'timeout', 'tls', 'http', 'parse', 'kind-mismatch', 'render'))`;
const SOURCE_JSON_CHECK = `check (json_valid (source_json) and json_type (source_json) = 'object')`;
const TIME_SPEC_JSON_CHECK = `check (json_valid (time_spec_json) and json_type (time_spec_json) = 'object')`;
const CACHE_JSON_CHECK = `check (json_valid (cache_json) and json_type (cache_json) = 'object')`;
const VARY_JSON_CHECK = `check (json_valid (vary_json) and json_type (vary_json) = 'array')`;
const REPORT_JSON_CHECK = `check (report_json is null or (json_valid (report_json) and json_type (report_json) = 'object'))`;

/**
 * The sources table is a copy of `sources/*.json` (D-011): the spec travels as
 * canonical JSON in `source_json`, with its scalar fields beside it so the
 * scheduler and the health page can query without parsing. `cadenceCron` and
 * `quietHours` are the two fields the scheduler reads on every tick, so they
 * get their own column (`time_spec_json`) and are validated by core's `parseCron`
 * on the way out.
 */
const MIGRATION_1 = [
  `create table sources (
    id text primary key,
    kind text not null ${KIND_CHECK},
    label text not null,
    url text not null,
    group_name text not null,
    enabled integer not null,
    cadence_minutes integer not null,
    weight real not null,
    match_count integer,
    source_json text not null ${SOURCE_JSON_CHECK},
    time_spec_json text not null ${TIME_SPEC_JSON_CHECK},
    health text not null ${HEALTH_CHECK},
    note text,
    last_status integer,
    last_polled_at text,
    last_success_at text,
    created_at text not null
  )`,
  `create index sources_enabled on sources (enabled, group_name)`,
  `create table items (
    source_id text not null,
    key text not null,
    kind text not null ${KIND_CHECK},
    title text not null,
    link text not null,
    summary text,
    image text,
    author text,
    published_at text,
    body text not null,
    section text,
    first_seen_at text not null,
    last_seen_at text not null,
    last_changed_at text,
    edit_count integer not null,
    read_at text,
    score_realtime real not null,
    score_digest real not null,
    primary key (source_id, key),
    foreign key (source_id) references sources (id) on delete cascade
  ) without rowid`,
  /*
   * `without rowid` sits **after** the closing parenthesis (measured: inside
   * the column list it is a syntax error). A composite key on a rowid table
   * would keep a rowid per item and a second index for the key; the paper only
   * ever addresses an item by `(source_id, key)`.
   */
  `create index items_last_seen on items (last_seen_at desc, source_id, key)`,
  `create index items_section on items (section, last_seen_at desc)`,
  `create index items_published on items (published_at desc)`,
  /*
   * `ItemEventRecord.id` is a number, so the primary key is a rowid.
   * `autoincrement` is measured to matter: after every row of a plain
   * `integer primary key` is deleted the next insert reuses rowid 1, and an
   * event id that comes back is an id a client already has.
   */
  `create table item_events (
    id integer primary key autoincrement,
    source_id text not null,
    item_key text not null,
    kind text not null ${EVENT_KIND_CHECK},
    at text not null,
    title text not null,
    link text not null,
    score real not null,
    report_json text ${REPORT_JSON_CHECK},
    foreign key (source_id, item_key) references items (source_id, key) on delete cascade
  )`,
  `create index item_events_recent on item_events (at desc, id desc)`,
  `create index item_events_source on item_events (source_id, at desc)`,
  /*
   * One row per poll, `not-modified` polls included (docs/architecture.md step
   * 9). The byte count and the status are what make "this source answered 304
   * 400 times" a sentence rather than a guess.
   */
  `create table snapshots (
    id integer primary key autoincrement,
    source_id text not null,
    taken_at text not null,
    outcome text not null ${OUTCOME_CHECK},
    status integer not null,
    bytes integer not null,
    duration_ms integer,
    item_count integer,
    error_kind text ${ERROR_KIND_CHECK},
    note text,
    foreign key (source_id) references sources (id) on delete cascade
  )`,
  `create index snapshots_source on snapshots (source_id, taken_at desc, id desc)`,
];

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
const MIGRATION_2 = [
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

/** Versions with no file in the repo (`user_version > head`) are refused. */
export const MAX_MIGRATION_VERSION = 100;

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
const MIGRATION_3 = [
  `alter table source_validators add column selection_hash text`,
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
  `drop table snapshots`,
  `alter table snapshots_v3 rename to snapshots`,
  `create index snapshots_source on snapshots (source_id, taken_at desc, id desc)`,
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
const MIGRATION_4 = [
  'alter table items add column missing_streak integer not null default 0',
  'alter table items add column gone_at text',
];

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'base', statements: MIGRATION_1 },
  { version: 2, name: 'validator-state', statements: MIGRATION_2 },
  { version: 3, name: 'selection-rung', statements: MIGRATION_3 },
  { version: 4, name: 'disappearance', statements: MIGRATION_4 },
];

export const CURRENT_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

/** The values a check accepts, exported so a test can pin them to core. */
export const CHECK_KINDS: readonly SourceKind[] = ['rss', 'html', 'json'];
export const CHECK_EVENT_KINDS: readonly EventKind[] = ['new', 'edited', 'gone'];
export const CHECK_HEALTH_STATES: readonly HealthState[] = [
  'unknown',
  'ok',
  'blocked',
  'no-matches',
  'restructured',
  'error',
  'stale',
];
export const CHECK_ERROR_KINDS: readonly ErrorKind[] = [
  'network',
  'timeout',
  'tls',
  'http',
  'parse',
  'kind-mismatch',
  'render',
];
export const SNAPSHOT_OUTCOMES: readonly [
  'not-modified',
  'same-body',
  'declared-unchanged',
  'selection-unchanged',
  'changed',
  'error',
] = ['not-modified', 'same-body', 'declared-unchanged', 'selection-unchanged', 'changed', 'error'];
