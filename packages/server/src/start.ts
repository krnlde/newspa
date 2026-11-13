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
 * URL, not by launching Edge), the toast sender (WP10), and every command whose
 * answer is the paper (WP5's cut list). The picker (WP6) **is** wired here, and it
 * opens its window on the machine that runs this process — which is why `/api/pick`
 * is a loopback route (rule 20): a LAN peer cannot ask a desk machine to launch a
 * browser. The process edge — argv,
 * `console`, signals, exit codes — is `cli.ts`, coverage-excluded as a process edge;
 * `boot` is a function of a `BootDeps` bag, so `cli.ts` supplies `process` and a test
 * supplies a temp root, a stub poll and port 0. That is what lets the roadmap's
 * acceptance ("`start` serves a paper from a real poll") run offline, in seconds.
 */
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceIssue, SourceSpec } from 'newspa-config';
import { ensureSourcesDir, loadAppConfig, loadSources, sourceFilePath } from 'newspa-config';
import { type Database, releaseLock } from 'newspa-db';
import type { FetchLike } from 'newspa-fetch';
import { openPickSession } from 'newspa-fetch';
import { openBootDb } from './bootDb.ts';
import { handleRequest } from './httpApp.ts';
import { ownerToken } from './lockOwner.ts';
import { reachLine } from './net.ts';
import { pickRoutes, readSourceForPick } from './pickApi.ts';
import { pickTextFetcher } from './pickTransport.ts';
import { pollOne, transportDepsOf } from './poll.ts';
import { pollDepsOf } from './pollDeps.ts';
import type { PollResult } from './pollTypes.ts';
import { type Scheduler, type SchedulerTally, startScheduler } from './scheduler.ts';
import { sourcesRoutesOf } from './sourcesApi.ts';
import { createHub, type Hub } from './sse.ts';
import { stateOf } from './state.ts';
import { schemeOf, type TlsMaterial, type TlsPaths, tlsFailureLine, tlsMaterialOf } from './tls.ts';

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

/**
 * The watchlist, as boot lines: the count, every issue, and what an empty list means.
 */
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

/**
 * TLS, decided **before the database is claimed** (D-039): a pair with a typo in a
 * path stops the boot, and a boot that stops should not have opened a file,
 * migrated a schema and taken a claim on the way to saying so. The scheme comes from
 * the same call that read the pair, so the reach line at the bottom of `boot`
 * prints what the socket speaks (D-034).
 */
const tlsBootOf = async (
  root: string,
  configFile: string,
  tls: TlsPaths | null,
  log: (line: string) => void,
): Promise<{ scheme: 'http' | 'https'; material: TlsMaterial | null }> => {
  if (tls === null) return { scheme: schemeOf(null), material: null };
  let material: TlsMaterial;
  try {
    material = await tlsMaterialOf(root, tls);
  } catch (cause) {
    log(tlsFailureLine(cause));
    throw cause;
  }
  log(
    `tls: ${tls.cert} + ${tls.key} — paths, never PEM bytes in ${configFile} (D-039: a key in config.json rides into every export --bundle)`,
  );
  return { scheme: schemeOf(tls), material };
};

/** The boot. Every input is a parameter, so a test runs it against a temp tree. */
export const boot = async (deps: BootDeps): Promise<Running> => {
  const log = deps.log;
  const now = deps.now ?? ((): Date => new Date());
  const { config, file, messages } = await loadAppConfig(join(deps.root, 'config.json'));
  log(`config: ${file}`);
  for (const message of messages) log(message);

  const { scheme, material } = await tlsBootOf(deps.root, file, config.server.tls, log);

  const dir = join(deps.root, 'sources');
  if ((await ensureSourcesDir(dir)).created) {
    log('created the sources directory: it did not exist (D-025 — boot creates it, a read does not)');
  }

  const host = deps.host ?? config.server.host;
  const port = deps.port ?? config.server.port;
  const token = deps.token ?? ownerToken();

  const db = await openBootDb(deps.root, token, now, log);

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

  const handler = handleRequest({
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
    sources: sourcesRoutesOf({ dir, db, now, log }),
    pick: pickRoutes({
      specOf: (id) => readSourceForPick(dir, id, (path) => readFile(path, 'utf8'), sourceFilePath),
      fetchText: pickTextFetcher(transportDepsOf(pollDeps, now)),
      launch: openPickSession,
      // A reader's pick is a window (D-036). Headless would be a pick that picks
      // nothing: the click is the reader's, and it needs a screen to happen on.
      headless: false,
      // `profiles/<id>` is the only credential in this project (rule 17), and
      // `profile: true` is what makes a logged-in list visible to the pick.
      profilesDir: join(deps.root, 'profiles'),
      log,
      now,
    }),
    dist: join(deps.root, 'apps', 'web', 'dist'),
    log,
    addressOf: (req: IncomingMessage) => req.socket.remoteAddress,
  });
  // One handler, two sockets: the scheme is decided by `server.tls` and read at the
  // top of this function, so the line the boot printed is the scheme the socket
  // speaks (D-034: the address is the wall, and the wall is described truthfully).
  const server = material === null ? createHttpServer(handler) : createHttpsServer(material, handler);
  const bound = await listen(server, host, port);
  deps.onListen?.(bound);

  log(`${config.masthead.name} — ${config.masthead.tagline}`);
  log(reachLine(host, bound, scheme));

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
