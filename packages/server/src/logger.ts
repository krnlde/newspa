/**
 * The server's log (D-046): pino is the engine, and the repo owns the **words**.
 *
 * Two shapes, chosen by where the text lands. A terminal gets
 * `14:33:08 info strata-releases 200 changed · 10 items · 412 ms`, because a human
 * reads a terminal and asked for the clock; anything redirected to a file gets one
 * JSON object per line, because a board (WP15) and a log file are read by `jq`, not
 * by an eye. `base: undefined` drops `pid` and `hostname`, which say nothing about a
 * paper that runs as one process the reader started by hand.
 *
 * Why a library and not a `console.log` prefix: levels, a JSON mode and the clock
 * are the part worth buying; the pretty printer is not, so `pino-pretty` stays out
 * (a transport of its own, ten dependencies, worker threads, for formatting a line
 * of text — the same reasoning that hand-writes `sw.js` and refuses Workbox).
 *
 * The line for a poll is `pollLine`: the source, the status, the
 * `snapshots.outcome` word, and what the poll counted. It is the same vocabulary the
 * database stores, so the terminal and the row cannot tell two stories, and it is
 * rule 6 in print: a ladder rung that never fires is invisible, and a poll that
 * prints nothing is a fetch nobody can see.
 */

import { Writable } from 'node:stream';
import type { AppConfig } from 'newspa-config';
import { type Logger, pino } from 'pino';
import type { PollResult } from './pollTypes.ts';

/** The knob's type is the schema's, so a new level is one edit in one place. */
export type LogLevel = AppConfig['server']['logLevel'];

/** `HH:MM:SS`, local: the reader's clock, not the epoch. */
const clockOf = (epoch: number): string => new Date(epoch).toTimeString().slice(0, 8);

/** A pino record, as a human should see it. `level` is pino's word, lower-cased. */
const humanLine = (record: { time: number; level: string; msg?: string }): string =>
  [clockOf(record.time), record.level, record.msg ?? ''].filter((part) => part !== '').join(' ');

const humanSink = (): Writable =>
  new Writable({
    write(chunk, _encoding, callback) {
      console.log(humanLine(JSON.parse(String(chunk)) as Parameters<typeof humanLine>[0]));
      callback();
    },
  });

/** The JSON path's own destination, so the test can read what a log file receives. */
const stdoutSink = (): Writable =>
  new Writable({
    write(chunk, _encoding, callback) {
      process.stdout.write(String(chunk));
      callback();
    },
  });

/**
 * The logger. `isTty` is a parameter because a test asserts both shapes, and a CI
 * run has no TTY while a reader's terminal always does.
 *
 * **The destination is the second argument, not `options.stream`** — measured on
 * pino 10.4.0: `{ stream }` is accepted silently and the record goes to stdout
 * anyway, which is a formatter that never runs; `pino(options, stream)` writes to
 * the stream, synchronously. A pretty printer that quietly prints nothing is the
 * silent zero in a library's clothes (rule 5). Both shapes therefore run through a
 * sink the repo owns, which is also what makes the JSON line testable.
 */
export const createLogger = (level: LogLevel, isTty: boolean = process.stdout.isTTY === true): Logger =>
  pino(
    {
      level,
      // `{}`, not `undefined`: measured on pino 10.4.0, an empty base object drops
      // `pid` and `hostname` (which say nothing about a paper that runs as one process
      // the reader started by hand), and `exactOptionalPropertyTypes` forbids passing
      // `undefined` for an optional property.
      base: {},
      // The level as its **word**, in both shapes: `info` in the terminal, and in the
      // JSON a board's log file is read by `jq`, where a bare `30` asks the reader to
      // know pino's table.
      formatters: { level: (label: string): Record<string, string> => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    isTty ? humanSink() : stdoutSink(),
  );

/** `60.3 KB`, one decimal: the size that tells a reader a feed is heavy. */
const kilobytesOf = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

/** `1 item`, `10 items`: this line is read by a person, so it says the number's word. */
const counted = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * One poll, one line. The order is the reader's question: **what, from where, with
 * what result, what it counted, how big, how slow**.
 *
 * `itemCount: null` means this poll counted no items — a `304`, a matching body hash,
 * a matching selection hash (D-006) — so it prints no item clause, and the outcome
 * word says why. `0` is a different claim and prints `0 items`.
 */
export const pollLine = (result: PollResult): string => {
  const parts = [`${result.sourceId} ${String(result.status)} ${result.outcome}`];
  if (result.itemCount !== null) {
    const countedParts = [
      counted(result.itemCount, 'item'),
      ...(result.newItems > 0 ? [`+${String(result.newItems)} new`] : []),
      ...(result.editedItems > 0 ? [`+${String(result.editedItems)} edited`] : []),
      ...(result.goneItems > 0 ? [`−${String(result.goneItems)} gone`] : []),
    ];
    parts.push(countedParts.join(', '));
  }
  if (result.bytes > 0) parts.push(kilobytesOf(result.bytes));
  parts.push(`${String(result.durationMs)} ms`);
  // A poll that is not `ok` names its own state and its evidence, so the line the
  // terminal prints is the line the health strip shows (rule 5, and D-029's streak
  // is invisible from the page alone).
  if (result.health !== 'ok') parts.push(`${result.health}: ${result.note}`);
  return parts.join(' · ');
};

/** The two channels the loop needs, built from one logger. */
export const channelsOf = (
  logger: Logger,
): { log: (line: string) => void; debug: (line: string) => void; setLevel: (level: LogLevel) => void } => ({
  log: (line: string): void => {
    logger.info(line);
  },
  debug: (line: string): void => {
    logger.debug(line);
  },
  setLevel: (level: LogLevel): void => {
    logger.level = level;
  },
});
