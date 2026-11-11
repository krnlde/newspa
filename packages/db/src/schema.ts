/**
 * The base DDL and the CHECK vocabulary it is written with, as forward-only
 * migrations keyed by `PRAGMA user_version`. Each migration is a list of
 * statements that `migrate()` runs inside one transaction, so a migration that
 * fails halfway leaves the version number where it was (measured: `exec` runs a
 * script verbatim, so the transaction is the only all-or-nothing boundary).
 *
 * The migrations that grew after this schema (`MIGRATION_2..5`), the
 * `MIGRATIONS` list and `CURRENT_VERSION` are in `migrationHistory.ts`, which
 * reads the base DDL and these CHECK constants — rule 1's 300-line cap, split at
 * the seam that is real: migration 1 is the schema a fresh database starts from,
 * the history is what the paper learned to need. The import runs one way only
 * (`migrationHistory.ts` says why: a cycle left these constants uninitialised
 * mid-interpolation, and the DDL reached SQLite as `json_type (undefined)`).
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
 *  - `sources.next_run_at` / `sources.consecutive_failures` — the scheduler's
 *    countdown. `SourceSpec` has no field for them and the paper's read side has
 *    no field for them either, so `insert`/`upsert` do not name them: a
 *    re-import of a source the scheduler is watching must not reset its own
 *    countdown. `sourcesScheduling.ts` owns both.
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
export const OUTCOME_CHECK_V3 = `check (outcome in ('not-modified', 'same-body', 'declared-unchanged', 'selection-unchanged', 'changed', 'error'))`;
export const ERROR_KIND_CHECK = `check (error_kind is null or error_kind in ('network', 'timeout', 'tls', 'http', 'parse', 'kind-mismatch', 'render'))`;
const SOURCE_JSON_CHECK = `check (json_valid (source_json) and json_type (source_json) = 'object')`;
const TIME_SPEC_JSON_CHECK = `check (json_valid (time_spec_json) and json_type (time_spec_json) = 'object')`;
export const CACHE_JSON_CHECK = `check (json_valid (cache_json) and json_type (cache_json) = 'object')`;
export const VARY_JSON_CHECK = `check (json_valid (vary_json) and json_type (vary_json) = 'array')`;
const REPORT_JSON_CHECK = `check (report_json is null or (json_valid (report_json) and json_type (report_json) = 'object'))`;

/**
 * The sources table is a copy of `sources/*.json` (D-011): the spec travels as
 * canonical JSON in `source_json`, with its scalar fields beside it so the
 * scheduler and the health page can query without parsing. `cadenceCron` and
 * `quietHours` are the two fields the scheduler reads on every tick, so they
 * get their own column (`time_spec_json`) and are validated by core's `parseCron`
 * on the way out.
 *
 * Exported because `migrationHistory.ts` names it in `MIGRATIONS`: the base DDL
 * and the history are one ladder, read in one direction.
 */
export const MIGRATION_1 = [
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

/** Versions with no file in the repo (`user_version > head`) are refused. */
export const MAX_MIGRATION_VERSION = 100;

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
