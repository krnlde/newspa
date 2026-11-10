/**
 * The poll's test harness: a fixture payload served by an injected `fetch`, into
 * a real in-memory database, through `pollOne`.
 *
 * No test in this file family touches a network (the rule `packages/fetch`
 * already follows): the response is a constructed `Response`, the clock is
 * `FIXED` from `support.ts`, and the retry sleep is a no-op, so a `500` that
 * retries twice costs no wall time. The fixtures are `packages/fetch`'s own
 * captures — the same bytes the parser's contract is pinned with, which is the
 * point: a poll of the real BBC feed body, end to end, into `StateResponse`.
 *
 * A handler is told which call number it is answering and what headers the
 * request sent, so the ladder is testable as it is really driven: layer 0 fires
 * only because the request carried `If-None-Match`, and the test can read that
 * header.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceSpec } from 'newspa-config';
import type { Database } from 'newspa-db';
import type { FetchLike } from 'newspa-fetch';
import { pollOne } from '../src/poll.ts';
import { pollDepsOf } from '../src/pollDeps.ts';
import type { PollDeps, PollResult } from '../src/pollTypes.ts';
import { addSource, FIXED, openDb } from './support.ts';

/** `packages/fetch`'s captured payloads, read as text (a parser's input is a decoded body). */
const fixtures = new URL('../../fetch/test/fixtures/', import.meta.url);
export const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(name, fixtures)), 'utf8');

/** A captured body, mutated: the only way to get a second version of one publisher's text. */
export const edited = (name: string, find: string, replace: string): string => fixture(name).replace(find, replace);

/** A request the pipeline made, with the headers it sent. */
export interface Call {
  readonly url: string;
  readonly headers: Headers;
}

/** Answer the nth call (1-based), knowing what the request asked for. */
export type Handler = (call: number, request: Call) => Response | Promise<Response>;

/** A body with the validators a well-behaved cacheable feed sends with it. */
export const okResponse = (
  body: string,
  etag = '"cap-1"',
  contentType = 'application/rss+xml; charset=utf-8',
): Response => new Response(body, { status: 200, headers: { etag, 'content-type': contentType } });

/** A `304`: no body is legal on this status, so the constructor must be handed `null`. */
export const notModified = (etag = '"cap-1"'): Response => new Response(null, { status: 304, headers: { etag } });

/** The handler the ladder tests want: the first poll gets the body, later ones get a `304`. */
export const conditional =
  (name: string): Handler =>
  (_call, request) =>
    request.headers.get('if-none-match') === null ? okResponse(fixture(name)) : notModified();

/** The harness: a database with the source registered, and a poll to run against it. */
export interface PollHarness {
  readonly db: Database;
  readonly deps: PollDeps;
  readonly calls: Call[];
  readonly waits: number[];
  readonly poll: () => Promise<PollResult>;
  /** The same source, polled at another instant: `last_seen_at` moves only if a parse ran. */
  readonly pollAt: (now: Date) => Promise<PollResult>;
}

export const pollHarness = (spec: SourceSpec, handler: Handler, over: Partial<PollDeps> = {}): PollHarness => {
  const db = openDb();
  addSource(db, spec);
  const calls: Call[] = [];
  const waits: number[] = [];
  const fetch: FetchLike = async (input, init) => {
    const request: Call = { url: input, headers: new Headers(init.headers) };
    calls.push(request);
    return await handler(calls.length, request);
  };
  const deps = pollDepsOf(db, {
    fetch,
    now: () => FIXED,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    ...over,
  });
  return {
    db,
    deps,
    calls,
    waits,
    poll: () => pollOne(spec, deps),
    pollAt: (now: Date) => pollOne(spec, { ...deps, now: () => now }),
  };
};

/** The one instant every fixture poll is stamped with. */
export const TAKEN_AT = FIXED.toISOString();

/** The validator state a poll left behind, with a failure that names the source. */
export const storedState = (db: Database, sourceId: string) => {
  const read = db.validators.read(sourceId);
  if (read.ok === false) throw new Error(`no validator state for ${sourceId}: ${read.reason}`);
  return read.state;
};
