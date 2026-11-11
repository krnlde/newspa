/**
 * Shared fixtures for the disappearance ladder's poll tests (D-029).
 *
 * The one thing a test of this rule must get right is that **every poll gets its
 * own `Response`**: a body can be read once, so a canned response handed to two
 * polls leaves the second with no bytes - which looks exactly like "the source
 * listed nothing", the very claim these tests are trying to make. Hence a
 * factory per poll.
 */
import type { Database } from 'newspa-db';
import { expect } from 'vitest';
import { fixture, type Handler, type PollHarness } from './pollSupport.ts';
import { anHtmlSpec } from './support.ts';

export const FEED = 'feed-bbc-world.xml';
export const CARDS = 'html-card-list.html';
export const HTML_TYPE = 'text/html; charset=utf-8';
export const SOURCE = 'bbc';

/** One `<item>` block of the capture, removed: the feed stopped listing that story. */
export const dropItem = (body: string, n: number): string => {
  let from = -1;
  for (let i = 0; i <= n; i += 1) from = body.indexOf('<item>', from + 1);
  const to = body.indexOf('</item>', from);
  return body.slice(0, from) + body.slice(to + '</item>'.length);
};

/**
 * A factory per poll, the last repeating for every poll after it. Each entry
 * builds a **fresh** response, so every poll reads a complete body.
 */
export const served = (first: () => Response, ...rest: (() => Response)[]): Handler => {
  const all = [first, ...rest];
  return (call) => (all[Math.min(call - 1, all.length - 1)] ?? first)();
};

/**
 * A plan the **test** drives: it names the poll, so every attempt of that poll
 * gets the same response. The transport retries a `5xx`, and a plan keyed by call
 * number answers a retry with the *next* poll's body - a fixture that lies, in the
 * one test where the point is that the poll failed.
 */
export const planFor = (first: () => Response, ...rest: (() => Response)[]) => {
  const all = [first, ...rest];
  let poll = 0;
  return {
    handler: (): Response => (all[Math.min(poll, all.length - 1)] ?? first)(),
    at: (index: number): void => {
      poll = index;
    },
  };
};

export const goneEvents = (db: Database): number => db.itemEvents.count({ sourceId: SOURCE, kind: 'gone' });

/** Every key this source has stored and the last item pass did not list. */
export const absentOf = (h: PollHarness) => h.db.items.storedKeys(SOURCE).filter((row) => row.missingStreak > 0);

/** The state of the single absent key, with that singularity pinned. */
export const absentOfOne = (h: PollHarness) => {
  const rows = absentOf(h);
  expect(rows, 'the ladder is about exactly one key in these tests').toHaveLength(1);
  return rows[0] ?? { key: '', title: '', link: '', scoreRealtime: 0, missingStreak: 0, goneAt: null };
};

/**
 * The cards page with the second entry **removed**: the publisher stopped listing
 * it. That is the archive shape, and it is the shape that reaches the item pass -
 * the watched node's text changed, so the selection rung declines and the parse
 * runs.
 *
 * The edit a test must not make is one that leaves the text standing (dropping an
 * anchor, a class, a wrapper): then the source is telling the truth when it says
 * the watched node did not move, the rung fires, and the ladder correctly refuses
 * to read a re-render as a retirement. Measured here, on the way: the anchor-only
 * edit produced `selection-unchanged`, and no disappearance, forever.
 */
export const archivedCards = (): string => {
  const body = fixture(CARDS);
  const first = body.indexOf('<li class="card">');
  const start = body.indexOf('<li class="card">', first + 1);
  const end = body.indexOf('</li>', start);
  return body.slice(0, start) + body.slice(end + '</li>'.length);
};

/** The card spec every html test in this family uses. */
export const cardsSpec = () =>
  anHtmlSpec({ id: SOURCE, list: 'ul.cards .card', fields: { title: '.title', summary: '.deck', link: 'a' } });
