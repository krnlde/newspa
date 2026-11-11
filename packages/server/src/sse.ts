/**
 * The SSE hub (WP4): one open stream per browser, fed by the scheduler's
 * `publish`.
 *
 * The contract is core's (`serverEventSchema`), and the client is built
 * (`apps/web/src/api.ts`'s `openEvents`, which parses every message and reports a
 * malformed one). What the hub owns is the socket's half:
 *
 *  - **headers that survive a network**, because the paper is now reachable over
 *    LAN (D-034): `no-store` so no proxy caches a live stream,
 *    `x-accel-buffering: no` so a buffering proxy cannot turn a push into a
 *    stall-and-dump, and a `retry:` so a dropped phone reconnects by itself;
 *  - **a keep-alive comment**, on the hub's one timer, not a timer per client:
 *    a stream that goes quiet for minutes is dropped by a NAT, and a dropped
 *    stream is a paper that stops updating with a green tab;
 *  - **a client that cannot be written is removed, and said**: `res.write`
 *    returning `false` is a peer that cannot keep up, and a paper whose poller
 *    waits on a dead socket has the wrong priority. The removal is logged
 *    (rule 5 — a disappearance with no trace is how a UI defect becomes
 *    permanent).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerEvent } from 'newspa-core';

/** The reconnect the browser is told to use. A phone's radio, with room. */
export const RECONNECT_MS = 3_000;
/** Quiet for this long and a middlebox may drop the socket (the dev plugin measures 25 s). */
export const KEEP_ALIVE_MS = 25_000;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // `no-transform`: a proxy that "helpfully" compresses a stream buffers it.
  'cache-control': 'no-store, no-cache, must-revalidate, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

export interface Hub {
  /** Take the socket over, and start feeding it. */
  readonly subscribe: (req: IncomingMessage, res: ServerResponse) => void;
  /** One event, to every live client. Returns how many got it. */
  readonly publish: (event: ServerEvent) => number;
  /** Live clients. The number the boot report and a test read. */
  readonly clients: () => number;
  /** End every stream and stop the keep-alive. Idempotent. */
  readonly close: () => void;
}

/** One frame, exactly as the `text/event-stream` wire wants it. */
const frameOf = (event: ServerEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/**
 * The hub. `now` is injected so a test can pin the greeting's timestamp; the
 * keep-alive is a plain interval, `unref`'d so a test process can exit.
 */
export const createHub = (deps: { readonly log: (line: string) => void; readonly keepAliveMs?: number }): Hub => {
  const live = new Set<ServerResponse>();
  let closed = false;

  const timer = setInterval(() => {
    for (const res of [...live]) {
      if (res.write(': keep-alive\n\n')) continue;
      live.delete(res);
      deps.log(`sse: dropped a client that could not keep up (${String(live.size)} left)`);
      res.end();
    }
  }, deps.keepAliveMs ?? KEEP_ALIVE_MS);
  timer.unref();

  const drop = (res: ServerResponse, why: string): void => {
    live.delete(res);
    deps.log(`sse: client gone (${why}), ${String(live.size)} left`);
    res.end();
  };

  const subscribe = (req: IncomingMessage, res: ServerResponse): void => {
    if (closed) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('the paper is closing\n');
      return;
    }
    res.writeHead(200, SSE_HEADERS);
    // The first frame is a comment with the `retry:` directive, so the browser's
    // `EventSource` is told how to come back; a comment is not a message, so the
    // client's parser never sees it and never reports it malformed.
    res.write(`: newspa stream\nretry: ${String(RECONNECT_MS)}\n\n`);
    live.add(res);
    const bye = (): void => {
      live.delete(res);
      deps.log(`sse: client closed, ${String(live.size)} left`);
    };
    req.on('close', bye);
    res.on('close', () => {
      live.delete(res);
    });
  };

  return {
    subscribe,
    publish: (event) => {
      const frame = frameOf(event);
      let delivered = 0;
      for (const res of [...live]) {
        if (res.write(frame)) {
          delivered += 1;
          continue;
        }
        drop(res, 'a write its buffer refused');
      }
      return delivered;
    },
    clients: () => live.size,
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const res of [...live]) {
        live.delete(res);
        res.end();
      }
    },
  };
};
