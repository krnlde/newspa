/**
 * The SSE hub, over a **real** socket: the headers a proxy obeys, the frames a
 * browser parses, the removal of a client that went away, and the drop of one that
 * cannot be written.
 *
 * The frames are asserted as text (`data: {json}\n\n`), because that is the wire:
 * `apps/web/src/api.ts` feeds `message.data` to core's `parseServerEvent`, so a
 * hub that writes `data:{json}` (no space) would pass a JSON-only test and fail in
 * a browser.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ServerEvent } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { createHub, KEEP_ALIVE_MS, RECONNECT_MS } from '../src/sse.ts';
import { readStream, withServer } from './httpSupport.ts';

const CYCLE_DONE: ServerEvent = {
  type: 'cycle:done',
  at: '2026-11-09T10:00:00.000Z',
  fetched: 2,
  newItems: 3,
  editedItems: 1,
};

const hubOn = (log: (line: string) => void, keepAliveMs?: number) => {
  const hub = createHub(keepAliveMs === undefined ? { log } : { log, keepAliveMs });
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    hub.subscribe(req, res);
  };
  return { hub, handler };
};

describe('the stream contract', () => {
  it('answers with the headers a live stream needs, and a first comment naming the retry', async () => {
    const { handler } = hubOn(() => undefined);
    await withServer(handler, async ({ base }) => {
      const stream = await readStream(base, '/', 1);
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(stream.headers.get('cache-control')).toContain('no-store');
      expect(stream.headers.get('cache-control')).toContain('no-transform');
      expect(stream.headers.get('x-accel-buffering')).toBe('no');
      expect(stream.body).toContain(`retry: ${String(RECONNECT_MS)}`);
      // A comment, not a message: the client's parser must never see this frame.
      expect(stream.body.startsWith(':')).toBe(true);
      expect(stream.body).not.toContain('data:');
    });
  });

  it('delivers published events as frames the client can parse, in order', async () => {
    const { hub, handler } = hubOn(() => undefined);
    await withServer(handler, async ({ base }) => {
      const opened = readStream(base, '/', 2);
      await new Promise((resolveSettle) => setTimeout(resolveSettle, 30));
      hub.publish({ type: 'cycle:start', at: CYCLE_DONE.at });
      hub.publish(CYCLE_DONE);
      const stream = await opened;
      expect(stream.body).toContain('data: {"type":"cycle:start","at":"2026-11-09T10:00:00.000Z"}\n\n');
      expect(stream.body).toContain(`data: ${JSON.stringify(CYCLE_DONE)}\n\n`);
    });
  });

  it('writes the keep-alive comment on the hub clock, so a middlebox cannot drop a quiet paper', async () => {
    const { handler } = hubOn(() => undefined, 10);
    await withServer(handler, async ({ base }) => {
      const stream = await readStream(base, '/', 3);
      expect(stream.body).toContain(': keep-alive\n\n');
    });
  });
});

describe('the hub bookkeeping', () => {
  it('counts live clients, and removes one that hangs up', async () => {
    const { hub, handler } = hubOn(() => undefined);
    const server = createServer(handler);
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const opened = await fetch(`http://127.0.0.1:${String(port)}/`);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 30));
    expect(hub.clients()).toBe(1);
    await opened.body?.cancel();
    for (let i = 0; i < 60 && hub.clients() > 0; i += 1) {
      await new Promise((resolveSettle) => setTimeout(resolveSettle, 10));
    }
    expect(hub.clients()).toBe(0);
    server.close();
  });

  it('publishing to no one is a counted zero, not an error', () => {
    const hub = createHub({ log: () => undefined });
    expect(hub.publish(CYCLE_DONE)).toBe(0);
    expect(hub.clients()).toBe(0);
  });

  it('drops a client whose buffer refuses a write, and says so (rule 5)', () => {
    const logs: string[] = [];
    const hub = createHub({ log: (line) => logs.push(line), keepAliveMs: KEEP_ALIVE_MS });
    const req = { on: () => undefined } as unknown as IncomingMessage;
    // A socket that refuses every write: the backpressure path, which a real
    // loopback socket will not produce on demand.
    const res = {
      writeHead: () => undefined,
      write: () => false,
      end: () => undefined,
      on: () => undefined,
    } as unknown as ServerResponse;
    hub.subscribe(req, res);
    expect(hub.publish(CYCLE_DONE)).toBe(0);
    expect(hub.clients()).toBe(0);
    expect(logs.join('\n')).toContain('a write its buffer refused');
  });

  it('drops a client on the keep-alive tick when its buffer refuses, and says so', async () => {
    const logs: string[] = [];
    const hub = createHub({ log: (line) => logs.push(line), keepAliveMs: 10 });
    const ended: number[] = [];
    const req = { on: () => undefined } as unknown as IncomingMessage;
    const res = {
      writeHead: () => undefined,
      write: (chunk: string) => chunk.startsWith(': newspa'),
      end: () => {
        ended.push(1);
      },
      on: () => undefined,
    } as unknown as ServerResponse;
    hub.subscribe(req, res);
    expect(hub.clients()).toBe(1);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 40));
    expect(hub.clients()).toBe(0);
    expect(ended).toHaveLength(1);
    expect(logs.join('\n')).toContain('could not keep up');
  });

  it('ends every live stream on close, so a stopping server does not leave a browser hanging', () => {
    const ended: number[] = [];
    const hub = createHub({ log: () => undefined });
    const req = { on: () => undefined } as unknown as IncomingMessage;
    const res = {
      writeHead: () => undefined,
      write: () => true,
      end: () => {
        ended.push(1);
      },
      on: () => undefined,
    } as unknown as ServerResponse;
    hub.subscribe(req, res);
    expect(hub.publish(CYCLE_DONE)).toBe(1);
    hub.close();
    expect(hub.clients()).toBe(0);
    expect(ended).toHaveLength(1);
  });

  it('closes every stream, and refuses a late subscribe with a reason', async () => {
    const logs: string[] = [];
    const { hub, handler } = hubOn((line) => logs.push(line));
    const server = createServer(handler);
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${String(port)}`;
    const opened = readStream(base, '/', 1);
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 30));
    hub.close();
    expect(await opened).toMatchObject({ status: 200 });
    expect(hub.clients()).toBe(0);
    hub.close();
    const late = await fetch(base, { method: 'GET' });
    expect(late.status).toBe(503);
    expect(await late.text()).toContain('closing');
    server.close();
  });
});
