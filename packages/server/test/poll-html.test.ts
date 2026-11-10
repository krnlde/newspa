/**
 * The **html** source, end to end — the shape an RSS fixture cannot reach.
 *
 * A page is not a feed in three ways that matter to the pipeline:
 *
 *  - it **scrapes a body**, so edit detection runs over prose, not over a
 *    summary the publisher wrote for a feed reader;
 *  - it often declares **no timestamp at all**, so layer 2 of the ladder has
 *    nothing to trust and the note has to say so;
 *  - the parser leaves a **note** on every success (what it sniffed, what it
 *    stripped), and that note is the line beside the source in the paper.
 */

import type { SourceSpec } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { edited, fixture, okResponse, pollHarness, storedState } from './pollSupport.ts';
import { anHtmlSpec, healthOfSource, stateOfDb, wireItems } from './support.ts';

const CARDS = 'html-card-list.html';
const PAGE = 'html-page-version.html';
const HTML_TYPE = 'text/html; charset=utf-8';
const LATER = new Date('2026-11-09T11:00:00.000Z');

const cards: SourceSpec = anHtmlSpec({
  id: 'bbc',
  list: 'ul.cards .card',
  fields: { title: '.title', summary: '.deck', link: 'a' },
});

/** A table page: one row is one story, and the second cell is its prose. */
const table: SourceSpec = anHtmlSpec({
  id: 'bbc',
  list: 'tbody tr',
  strip: ['.updated'],
  fields: { title: 'td:first-child', summary: 'td:nth-child(3)', link: 'td a', body: 'td:nth-child(2)' },
});

describe('an html page is a source like any other', () => {
  it('parses to stories, and the paper prints them with the parser’s note', async () => {
    const h = pollHarness(cards, () => okResponse(fixture(CARDS), '"cap-1"', HTML_TYPE));
    const result = await h.poll();

    expect(result.outcome).toBe('changed');
    // Two of the capture's cards are unpublishable by design — one has no
    // headline, one has a headline with no anchor — and the parser skips and
    // counts them rather than publishing a story with nowhere to go (rule 7).
    expect(result.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    expect(result.itemCount).toBeGreaterThan(1);
    expect(result.health).toBe('ok');
    // The parser's own note travels: the strip line is the sniff, not a
    // template the pipeline invented.
    expect(result.note).toContain('item(s) parsed · ');
    expect(h.db.snapshots.last('bbc')?.snapshot.note).toContain('HTTP 200');

    const state = stateOfDb(h.db);
    expect(wireItems(state)).toHaveLength(result.itemCount ?? 0);
    expect(healthOfSource(state, 'bbc').state).toBe('ok');
    expect(healthOfSource(state, 'bbc').note).toContain('parsed');
  });

  it('a page that declares no timestamp falls to the body hash, and says what it trusted', async () => {
    // The bytes are identical and the etag moves, so no 304 is possible and
    // only the stored hash can stop this poll.
    const h = pollHarness(cards, (call) => okResponse(fixture(CARDS), `"cap-${String(call)}"`, HTML_TYPE));
    await h.poll();
    expect(storedState(h.db, 'bbc').declaredModifiedAt).toBeNull();

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('same-body');
    // The note names the signal it did trust, and the source declares none, so
    // the bytes are the only fast path this page has (the counters prove it).
    expect(second.note).toContain('the stored hash matched');
    expect(storedState(h.db, 'bbc').fastPathHits).toBe(1);
    expect(storedState(h.db, 'bbc').declaredModifiedAt).toBeNull();
  });

  it('a scraped body is capped, and the strip rule keeps the noise out of it', async () => {
    const h = pollHarness(table, () => okResponse(fixture(PAGE), '"cap-1"', HTML_TYPE));
    await h.poll();

    const rows = h.db.items.list({ sourceId: 'bbc' });
    expect(rows.length).toBeGreaterThan(1);
    // Rule 7: the scrape exists to detect edits, and it is capped, never a mirror.
    expect(rows.every((item) => item.body.length > 0)).toBe(true);
    expect(rows.every((item) => item.body.length <= 1_200)).toBe(true);
    expect(rows.every((item) => !item.body.includes('Last updated'))).toBe(true);
  });

  it('a body-only edit is an edit: the headline is untouched and the story moved', async () => {
    const h = pollHarness(table, (call) =>
      call === 1
        ? okResponse(fixture(PAGE), '"cap-1"', HTML_TYPE)
        : okResponse(edited(PAGE, '<td>LTS</td>', '<td>Current</td>'), '"cap-2"', HTML_TYPE),
    );
    const first = await h.poll();
    expect(first.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    const row = h.db.items.list({ sourceId: 'bbc' }).find((item) => item.body.includes('LTS'));
    if (row === undefined) throw new Error('the capture has no row whose prose says LTS');

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.newItems).toBe(0);
    expect(second.editedKeys).toContain(row.key);

    const after = h.db.items.find('bbc', row.key);
    expect(after.title).toBe(row.title);
    expect(after.body).toContain('Current');
    expect(after.lastChangedAt).toBe(LATER.toISOString());
    expect(after.editCount).toBe(1);
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'edited' })).toBe(second.editedItems);
    // Every success restamps "the source is answering", which is what `isStale`
    // reads: a page that is failing ages, a page that edits a cell does not.
    expect(h.db.sources.find('bbc').lastSuccessAt).toBe(LATER.toISOString());
  });
});
