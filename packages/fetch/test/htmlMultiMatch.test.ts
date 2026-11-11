import { describe, expect, it } from 'vitest';
import { parseHtmlPayload } from '../src/html.ts';
import type { ParseResult } from '../src/results.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, htmlSource, okItems, okResult, pageSource } from './support.ts';

/**
 * D-026's upper bound: an HTML source with a `list` is a subscription to **one
 * node** — the newest entry — so the count the selector matched when it was
 * authored is a contract, not a hint. `seen > matchCount` is the page growing,
 * and it has to reach the paper (rule 5): core's `classifyFetch` only flags an
 * **under**-count (`itemCount / expected < 0.6`), so a 10-item poll for a recorded
 * 1 would print as `ok` forever, and `server/src/pollHealth.ts` can only map a
 * **fault's** reason to `errorKind: 'parse'`.
 *
 * The boundary is the test: `seen === matchCount` is the source doing what it
 * says, `seen > matchCount` is the fault. A source with **no** recorded count is
 * not checked at all — sources are hand-authored today and the picker that
 * writes the count does not exist yet, so that is the compatibility arm. The
 * file is separate from `html.test.ts` for rule 1: that file is at 288 lines.
 */
const parse = (
  name: string,
  list: string,
  fields: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): ParseResult => {
  const text = fixture(name);
  return parseHtmlPayload(text, htmlSource(list, fields, overrides), sniff(text));
};

/** N identical cards. The signal D-026 reads **is** a count, so the payload is generated, not pinned. */
const cardList = (count: number): string =>
  `<html><body><ul>${Array.from(
    { length: count },
    (_, index) =>
      `<li class="card"><h2 class="title">Story ${String(index)}</h2><a href="/story/${String(index)}">Read</a></li>`,
  ).join('')}</ul></body></html>`;

const overCount = (list: string, overrides: Record<string, unknown>, name: string) =>
  failed(parse(name, list, { title: '.title' }, overrides));

describe('the list is wider than the source recorded (D-026)', () => {
  it('succeeds when the selector matches exactly the recorded count', () => {
    const result = parse('html-card-list.html', '.card', { title: '.title' }, { matchCount: 4 });
    expect(okItems(result)).toHaveLength(2);
    expect(result.ok && result.matchCount).toBe(4);
  });

  it('names the over-count with the selector and both counts, and returns no items', () => {
    const failure = overCount('.card', { matchCount: 1 }, 'html-card-list.html');
    expect(failure.reason).toBe('multi-match');
    expect(failure.kind).toBe('html');
    expect(failure.sniffed).toBe('html');
    expect(failure.marker).toBe('<!doctype html');
    expect(failure.cause).toBe('.card');
    expect(failure.matchCount).toBe(4);
    expect(failure.itemCount).toBe(0);
    // The count pair is the actionable part, in the words `collectNodes` already
    // uses for the under-count half of the same signal.
    expect(failure.detail).toContain('matched 4 elements; the source recorded 1 when it was picked');
    // The parse ran on a real HTML payload: the sniff line is in `notes` even on
    // a fault, so the note says what arrived as well as what the selector saw.
    expect(failure.notes).toContain("starts with '<!doctype html'");
  });

  it('is the fault for a recorded 0 and any match, which is the widest reading of the rule', () => {
    const failure = overCount('.card', { matchCount: 0 }, 'html-card-list.html');
    expect(failure.reason).toBe('multi-match');
    expect(failure.cause).toBe('.card');
    expect(failure.matchCount).toBe(4);
    expect(failure.itemCount).toBe(0);
    expect(failure.detail).toContain('matched 4 elements; the source recorded 0 when it was picked');
  });

  it('prefers `no-matches` for a recorded 0 that matched nothing, so the ladder runs in order', () => {
    // `collectNodes` decides the zero before the over-count is looked at, so a
    // source recorded as an empty list keeps the note naming the 0.
    const failure = overCount('.legacy-rail', { matchCount: 0 }, 'html-card-list.html');
    expect(failure.reason).toBe('no-matches');
    expect(failure.matchCount).toBe(0);
    expect(failure.detail).toContain('the source recorded 0 when it was picked');
  });

  it('is a fault at the size the rule was written against: 10 nodes, a recorded 1', () => {
    const payload = cardList(10);
    const failure = failed(
      parseHtmlPayload(payload, htmlSource('li.card', { title: '.title' }, { matchCount: 1 }), sniff(payload)),
    );
    expect(failure.reason).toBe('multi-match');
    expect(failure.cause).toBe('li.card');
    expect(failure.matchCount).toBe(10);
    expect(failure.detail).toContain('matched 10 elements; the source recorded 1 when it was picked');
  });

  it('succeeds on a 10-node list when no count was recorded, the compatibility arm', () => {
    // No `matchCount` is **no contract**, not a contract of zero: the picker
    // that writes it does not exist, so every hand-authored source keeps
    // working exactly as it does today.
    const payload = cardList(10);
    const result = parseHtmlPayload(payload, htmlSource('li.card', { title: '.title' }), sniff(payload));
    expect(okItems(result)).toHaveLength(10);
    expect(okResult(result).matchCount).toBe(10);
  });

  it('is never a fault for a page source: it has no list that could grow', () => {
    // 100 cards, a recorded 1, the whole document as one item at `<id>:page`.
    // An over-count is normal for a feed and for `itemsPath` too, so the check
    // is item-mode HTML only.
    const text = fixture('html-cnn-lite.html');
    const result = parseHtmlPayload(text, pageSource({ matchCount: 1 }), sniff(text));
    expect(okItems(result)).toHaveLength(1);
    expect(okResult(result).matchCount).toBe(1);
  });
});
