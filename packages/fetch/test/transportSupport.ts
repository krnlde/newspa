import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FetchLike, TransportDeps } from '../src/transport.ts';
import {
  describeTransport,
  type TransportFailure,
  type TransportNotModified,
  type TransportOk,
  type TransportResult,
} from '../src/transportTypes.ts';

/**
 * Transport test helpers. **No test in this package touches a network**: the
 * `fetch` is injected, the clock is injected, and the retry sleep is recorded
 * instead of waited. The one place a real `globalThis.fetch` runs is
 * `transportServer.test.ts`, against a `node:http` stub on localhost — a local
 * socket is not the network, and it is the only way to prove the decoded-bytes
 * cap, a redirect and a real `304` through undici (docs/testing.md).
 */

const fixturesDir = new URL('./fixtures/', import.meta.url);

export const fixtureBytes = (name: string): Buffer => readFileSync(fileURLToPath(new URL(name, fixturesDir)));

/** A fixed instant, so `If-Modified-Since` and a `Retry-After` HTTP date are pinable. */
export const NOW_ISO = '2026-11-09T10:00:00.000Z';
export const fixedNow = (): Date => new Date(NOW_ISO);

export interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

export type Handler = (call: number, init: RequestInit) => Response | Promise<Response>;

/** A `fetch` that records every request and answers from `handler(callNumber, init)`. */
export const fakeFetch = (handler: Handler): { readonly fetch: FetchLike; readonly calls: Call[] } => {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    return await handler(calls.length, init);
  };
  return { fetch, calls };
};

export interface TransportHarness {
  readonly deps: TransportDeps;
  readonly calls: Call[];
  readonly waits: number[];
}

/** The deps every test wants: recorded requests, recorded waits, a frozen clock. */
export const harness = (handler: Handler, extra: TransportDeps = {}): TransportHarness => {
  const { fetch, calls } = fakeFetch(handler);
  const waits: number[] = [];
  return {
    calls,
    waits,
    deps: {
      fetch,
      now: fixedNow,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      ...extra,
    },
  };
};

/** The header a request actually sent, read case-insensitively the way a server reads it. */
export const sentHeader = (call: Call, name: string): string | null => new Headers(call.init.headers).get(name);

/** The request at an index, with a message that says how many were recorded. */
export const callAt = (h: TransportHarness, index: number): Call => {
  const call = h.calls[index];
  if (call === undefined) throw new Error(`no request recorded at index ${String(index)} of ${String(h.calls.length)}`);
  return call;
};

export const sentMethod = (call: Call): string => call.init.method ?? 'GET';

export const sentSignal = (call: Call): AbortSignal | null => {
  const signal = call.init.signal;
  return signal instanceof AbortSignal ? signal : null;
};

/** The subset of `ResponseInit` a test writes: a status, a text, plain headers. */
export interface ResponderInit {
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
}

/** A feed response. `null` body for the null-body statuses (`304`, `204`). */
export const xmlResponse = (body: string | null, init: ResponderInit = {}): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/rss+xml', ...init.headers } });

/** A page response. */
export const htmlResponse = (body: string | null, init: ResponderInit = {}): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'text/html', ...init.headers } });

/** A body that arrives in chunks, so a cap is exercised against a live stream. */
export const chunkedBody = (chunks: readonly string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
};

/** Narrow the union, and print the transport's own report when the expectation is wrong. */
export const okTransport = (result: TransportResult): TransportOk => {
  if (result.state !== 'ok') throw new Error(`expected a body, got ${describeTransport(result)}`);
  return result;
};

export const failedTransport = (result: TransportResult): TransportFailure => {
  if (result.state !== 'failure') throw new Error(`expected a named fault, got ${describeTransport(result)}`);
  return result;
};

export const notModifiedTransport = (result: TransportResult): TransportNotModified => {
  if (result.state !== 'not-modified') throw new Error(`expected a 304, got ${describeTransport(result)}`);
  return result;
};

/** All the notes as one string, for a `toContain` that prints the whole report. */
export const notesText = (result: TransportResult): string => result.notes.join('\n');
