/**
 * The entry point (WP5, MVP): `node packages/server/src/start.ts`.
 *
 * No argv dispatcher, no flags, no help text — the roadmap re-scoped WP5 to this,
 * because a terminal UI is not on the path to a paper that fills itself. What
 * happens here, in order, is the whole boot, and the order is the point:
 *
 *  1. **read and report the config** — every message `loadAppConfig` produced
 *     ("not present; using defaults") is printed, because a run whose config fell
 *     back to defaults in silence is a run whose author has to guess at it;
 *  2. **ensure `sources/`** — D-025: creating the directory is boot's job, not a
 *     side effect of a read, and a fresh clone has none;
 *  3. **open and migrate the db** — the open is what claims `db_lock`, so a second
 *     `pnpm start` is refused here, by name, before it can interleave a write;
 *  4. **load the watchlist and upsert it** — `sources/*.json` is the truth (D-011)
 *     and the rows are its runnable copies; every issue is printed and the run
 *     continues without that source (rule 5: an unreadable source file is a report,
 *     not a source that quietly stops existing);
 *  5. **start the scheduler**, publishing its cycles to the SSE hub;
 *  6. **serve** the two routes the app calls, the stream, and the built page.
 *
 * `server.host` defaults to loopback; widening it is the reader's line in
 * `config.json`, and the reach line prints what that choice means to a person
 * standing in front of a phone (D-034).
 *
 * Not here, on purpose: the browser spawn (`openBrowser` is honoured by the printed
 * URL, not by launching Edge), the toast sender (WP10), the picker (WP6), and every
 * command whose answer is the paper (WP5's cut list). The process edge — argv,
 * `console`, signals, exit codes — is `cli.ts`, coverage-excluded as a process edge;
 * `boot` is a function of a `BootDeps` bag, so `cli.ts` supplies `process` and a test
 * supplies a temp root, a stub poll and port 0. That is what lets the roadmap's
 * acceptance ("`start` serves a paper from a real poll") run offline, in seconds.
 */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceIssue, SourceSpec } from 'newspa-config';
import { ensureSourcesDir, loadAppConfig, loadSources } from 'newspa-config';
import { type Database, DatabaseLockedError, openDatabase, releaseLock } from 'newspa-db';
import type { FetchLike } from 'newspa-fetch';
import { handleRequest } from './httpApp.ts';
import { reachLine } from './net.ts';
import { pollOne } from './poll.ts';
import { pollDepsOf } from './pollDeps.ts';
import type { PollResult } from './pollTypes.ts';
import { type Scheduler, type SchedulerTally, startScheduler } from './scheduler.ts';
import { createHub, type Hub } from './sse.ts';
import { stateOf } from './state.ts';

/** The repo root, from this file's location: `pnpm start` works from any directory. */
export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface BootDeps {
  readonly root: string;
  readonly log: (line: string) => void;
  /** The socket for a poll. Absent means `globalThis.fetch`, which is a real poll. */
  readonly fetch?: FetchLike;
  readonly token?: string;
  readonly now?: () => Date;
  /** A test binds port 0 and reads the port back; production binds the config's. */
  readonly port?: number;
  readonly host?: string;
  /** The poll. The default is `pollOne`; a test that must not touch the net overrides. */
  readonly poll?: (spec: SourceSpec) => Promise<PollResult>;
  /** `false` serves the paper without polling: a test of the routes, not of the loop. */
  readonly schedule?: boolean;
  readonly onListen?: (port: number) => void;
}

export interface Running {
  readonly port: number;
  readonly db: Database;
  readonly hub: Hub;
  readonly scheduler: Scheduler;
  readonly tally: () => SchedulerTally;
  readonly close: () => Promise<void>;
}

const idleTally: SchedulerTally = {
  batches: 0,
  polled: 0,
  failed: 0,
  planned: 0,
  newItems: 0,
  editedItems: 0,
  lastBatchAt: null,
};

/**
 * The shape of a scheduler that does not run: the claim is the one the db open
 * already took, `tick` is a no-op, `stop` releases. `boot({ schedule: false })`
 * returns this, so a route test reads a real database without a poll reaching the
 * network.
 */
const idleScheduler = (db: Database): Scheduler => ({
  tick: async () => idleTally,
  stop: () => {
    releaseLock(db.tx, db.token);
  },
  tally: () => idleTally,
  running: () => false,
  claim: { ok: true, owner: db.owner },
});

const issueLine = (issue: SourceIssue): string =>
  `  refused: ${issue.file} [${issue.reason}]: ${issue.messages.join('; ')}`;

/** The watchlist, as boot lines: the count, every issue, and what an empty list means. */
const reportWatchlist = (
  log: (line: string) => void,
  dir: string,
  issues: readonly SourceIssue[],
  count: number,
): void => {
  log(`sources: ${String(count)} runnable in ${dir}`);
  for (const issue of issues) log(issueLine(issue));
  if (count === 0)
    log('  the paper will be empty and say so. Add a file, or run `pnpm sources:init` for the examples.');
};

const listen = (server: Server, host: string, port: number): Promise<number> =>
  new Promise((resolveListen, rejectListen) => {
    const onerror = (error: Error): void => {
      server.off('listening', onlistening);
      rejectListen(error);
    };
    const onlistening = (): void => {
      server.off('error', onerror);
      const bound = server.address();
      resolveListen(typeof bound === 'object' && bound !== null ? bound.port : port);
    };
    server.once('error', onerror);
    server.once('listening', onlistening);
    server.listen(port, host);
  });

/** The boot. Every input is a parameter, so a test runs it against a temp tree. */
export const boot = async (deps: BootDeps): Promise<Running> => {
  const log = deps.log;
  const now = deps.now ?? ((): Date => new Date());
  const { config, file, messages } = await loadAppConfig(join(deps.root, 'config.json'));
  log(`config: ${file}`);
  for (const message of messages) log(message);

  const dir = join(deps.root, 'sources');
  if ((await ensureSourcesDir(dir)).created) {
    log('created the sources directory: it did not exist (D-025 — boot creates it, a read does not)');
  }

  const host = deps.host ?? config.server.host;
  const port = deps.port ?? config.server.port;
  const token = deps.token ?? randomUUID();

  let db: Database;
  try {
    // The directory, first: SQLite will not create one, and a first run whose `data/`
    // is absent is a fresh clone, which is exactly the case boot is responsible for.
    await mkdir(join(deps.root, 'data'), { recursive: true });
    db = openDatabase(join(deps.root, 'data', 'newspa.db'), { token, now, lockStaleAfterMs: 10 * 60_000 });
  } catch (cause) {
    if (cause instanceof DatabaseLockedError) {
      // The claim is the boundary, and it is spoken: one process polls one paper.
      log(`not starting: ${cause.message}`);
      throw cause;
    }
    throw cause;
  }
  log(`db: ${db.file}, version ${String(db.version)} (${db.journalMode}), claim ${token.slice(0, 8)}`);

  const load = await loadSources(dir);
  reportWatchlist(log, dir, load.issues, load.sources.length);
  for (const spec of load.sources) db.sources.upsert(spec, now().toISOString());

  const hub = createHub({ log });
  const pollDeps = pollDepsOf(db, { now, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) });

  const scheduler =
    deps.schedule === false
      ? idleScheduler(db)
      : startScheduler({
          db,
          poll: deps.poll ?? ((spec: SourceSpec): Promise<PollResult> => pollOne(spec, pollDeps)),
          config: config.scheduler,
          now,
          sleep: (ms) =>
            new Promise((resolveSleep) => {
              setTimeout(resolveSleep, ms).unref();
            }),
          log,
          token,
          publish: (event) => {
            hub.publish(event);
          },
        });

  const server = createServer(
    handleRequest({
      state: () =>
        stateOf({
          sources: db.sources,
          items: db.items,
          itemEvents: db.itemEvents,
          snapshots: db.snapshots,
          masthead: config.masthead,
          now,
        }),
      hub,
      dist: join(deps.root, 'apps', 'web', 'dist'),
      log,
      addressOf: (req: IncomingMessage) => req.socket.remoteAddress,
    }),
  );
  const bound = await listen(server, host, port);
  deps.onListen?.(bound);

  log(`${config.masthead.name} — ${config.masthead.tagline}`);
  log(reachLine(host, bound));

  return {
    port: bound,
    db,
    hub,
    scheduler,
    tally: scheduler.tally,
    close: async () => {
      scheduler.stop();
      hub.close();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
      db.close();
    },
  };
};
