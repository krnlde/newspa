import { describe, expect, it, vi } from 'vitest';
import { channelsOf, createLogger, pollLine } from '../src/logger.ts';
import type { PollResult } from '../src/pollTypes.ts';
import { NO_PASS } from '../src/pollTypes.ts';

/**
 * The log (D-046): the poll's line, the clock, the level.
 *
 * `pollLine` is the part with a claim to keep: the words are `snapshots.outcome`'s,
 * so the terminal and the database row cannot tell two stories, and the clauses the
 * reader asked for — **what, with what status, what it counted, how slow** — are
 * pinned equal to the `PollResult` fields. The clock and the level are pino's job;
 * the tests here only say the adapter hands them over.
 */

const resultOf = (over: Partial<PollResult>): PollResult => ({
  sourceId: 'strata-releases',
  takenAt: '2026-11-13T14:33:07.588Z',
  outcome: 'changed',
  status: 200,
  bytes: 61_750,
  durationMs: 412,
  itemCount: 10,
  ...NO_PASS,
  health: 'ok',
  errorKind: null,
  note: '10 item(s) parsed · starts with ’<?xml’',
  ...over,
});

/** Capture what the logger writes. The human sink writes through `console.log`. */
const capture = (): { lines: string[]; stop: () => void } => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
    lines.push(String(args[0]));
  });
  return { lines, stop: () => spy.mockRestore() };
};

describe('the poll line', () => {
  it('names the source, the status, the outcome word, the counts, the bytes and the time', () => {
    expect(pollLine(resultOf({ newItems: 2, editedItems: 1, goneItems: 3, itemCount: 10 }))).toBe(
      'strata-releases 200 changed · 10 items, +2 new, +1 edited, −3 gone · 60.3 KB · 412 ms',
    );
  });

  it('says the number’s word, because a person reads this line', () => {
    expect(pollLine(resultOf({ newItems: 1, newKeys: ['k'], itemCount: 1 }))).toContain('1 item, +1 new');
  });

  it('prints a `304` with no item clause, because it counted nothing (D-006)', () => {
    const line = pollLine(
      resultOf({ outcome: 'not-modified', status: 304, itemCount: null, bytes: 0, durationMs: 38 }),
    );
    expect(line).toBe('strata-releases 304 not-modified · 38 ms');
  });

  it('keeps a counted `0` as a claim, not an absence', () => {
    // `itemCount: 0` is a parse that found nothing; `null` is a rung that skipped
    // the item pass. The line says `0 items` for the first and prints nothing for
    // the second, because rule 5 forbids a silent zero and D-006 forbids a fake one.
    expect(pollLine(resultOf({ itemCount: 0 }))).toContain('0 items');
  });

  it('names a state that is not `ok`, with the evidence the health strip shows', () => {
    const line = pollLine(
      resultOf({ outcome: 'error', status: 429, itemCount: null, health: 'blocked', note: '429 from the publisher' }),
    );
    expect(line).toBe('strata-releases 429 error · 60.3 KB · 412 ms · blocked: 429 from the publisher');
  });
});

describe('the logger', () => {
  it('stamps a terminal line with the clock, and lowers the level word', () => {
    const { lines, stop } = capture();
    try {
      createLogger('info', true).info('listening on https://127.0.0.1:8787');
    } finally {
      stop();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0] ?? '').toMatch(/^\d{2}:\d{2}:\d{2} info listening on https:\/\/127\.0\.0\.1:8787$/);
  });

  it('writes one JSON object per line when there is no terminal, with no pid and hostname', () => {
    // The JSON path is a **file/pipe**, so it is captured at stdout's own write, not
    // at `console.log`: pino's destination is a stream, and the repo's sink forwards
    // to `process.stdout.write` (see `stdoutSink`, and the measured `stream` quirk).
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    });
    try {
      createLogger('info', false).info('a poll');
    } finally {
      spy.mockRestore();
    }
    const record = JSON.parse(written.join('')) as Record<string, unknown>;
    expect(record).toMatchObject({ level: 'info', msg: 'a poll' });
    expect(new Date(String(record['time'])).toISOString()).toBe(String(record['time']));
    expect(record).not.toHaveProperty('pid');
    expect(record).not.toHaveProperty('hostname');
  });

  it('chooses its own destination when the caller names no TTY', () => {
    // The parameter's default is `process.stdout.isTTY`, and a test that always
    // passes the flag leaves that branch unexercised — the shape a reader actually
    // gets, in a terminal, is the one nobody tested.
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    });
    try {
      createLogger('info').info('a poll');
    } finally {
      spy.mockRestore();
    }
    expect(written.join('')).toContain('"msg":"a poll"');
  });

  it('answers to the level config names, through `setLevel`', () => {
    const logger = createLogger('info', true);
    const { log, debug, setLevel } = channelsOf(logger);
    const { lines, stop } = capture();
    try {
      log('a fetch');
      debug('a plan');
      setLevel('debug');
      debug('a plan');
    } finally {
      stop();
    }
    expect(lines.filter((line) => line.includes('a fetch'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('a plan'))).toEqual([expect.stringMatching(/debug a plan$/)]);
  });
});
