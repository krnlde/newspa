/**
 * A **JSON endpoint** polled end to end — the third source kind, and the one
 * with its own shape of the problems:
 *
 *  - the items live at a **path** inside a document (`hits`), beside paging
 *    fields the pipeline must ignore;
 *  - an item may carry **no summary at all** (a story title and a URL *is* a
 *    story), so the text an edit is measured on falls back to the title alone;
 *  - the document declares **no timestamp**, so layer 2 of the ladder has
 *    nothing to trust and the body hash is the only fast path;
 *  - the parser's note on a JSON success is the **sniff** (`starts with '{'`),
 *    so the health line is the count plus what the parser recognised, and the
 *    pipeline invents nothing.
 *
 * The payload is `packages/fetch`'s own capture of the Algolia front-page
 * endpoint, so the item shape is a publisher's, not one invented here.
 */
import { describe, expect, it } from 'vitest';
import { edited, fixture, okResponse, pollHarness, storedState } from './pollSupport.ts';
import { aJsonSpec } from './support.ts';

const API = 'json-hn-front-page.json';
const LATER = new Date('2026-11-09T11:00:00.000Z');

/** The front page of Hacker News: a path, and a title and a URL per story. */
const spec = aJsonSpec({
  id: 'bbc',
  itemsPath: 'hits',
  fields: { title: 'title', link: 'url', date: 'created_at' },
});

const serveApi =
  (body: string, etag = '"cap-1"') =>
  () =>
    okResponse(body, etag, 'application/json; charset=utf-8');

describe('a JSON endpoint is polled like any other source', () => {
  it('reads the items out of the document, keeps the paging fields out, and prints the count alone', async () => {
    const h = pollHarness(spec, serveApi(fixture(API)));
    const result = await h.poll();

    expect(result.outcome).toBe('changed');
    expect(result.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    expect(result.itemCount).toBeGreaterThan(3);
    expect(result.health).toBe('ok');

    // The parser's own note travels: the sniff is what it recognised, and the
    // pipeline adds no sentence of its own.
    expect(result.note).toBe(`${String(result.itemCount)} item(s) parsed · starts with '{'`);

    const rows = h.db.items.list({ sourceId: 'bbc' });
    // The paging fields beside `hits` (`nbHits`, `page`, `hitsPerPage`) are not
    // stories. Every published row has an absolute link the paper can send a
    // reader to — on the publisher's scheme, which is the publisher's choice.
    expect(rows.every((item) => /^https?:\/\//u.test(item.link))).toBe(true);
    expect(rows.some((item) => item.link.startsWith('http://'))).toBe(true);
    expect(rows.some((item) => /Goldman Sachs/u.test(item.title))).toBe(true);
    // `created_at` is the story's instant, not the poll's.
    const dated = rows.filter((item) => item.publishedAt !== null);
    expect(dated.length).toBe(rows.length);
    expect(rows.every((item) => (item.publishedAt ?? '').startsWith('2026-11-'))).toBe(true);
  });

  it('a story with no summary is still a story, and its edit is measured on its headline', async () => {
    const HEADLINE = 'Goldman Sachs is pulling Claude Code from its bankers and traders';
    const h = pollHarness(spec, (call) =>
      call === 1
        ? okResponse(fixture(API), '"cap-1"', 'application/json; charset=utf-8')
        : okResponse(
            // The field, not the highlight copy: this capture keeps two copies of
            // every title, and a loose replace edits the one the parser ignores.
            edited(
              API,
              `"title": "${HEADLINE}"`,
              '"title": "Goldman Sachs restores Claude Code after a week of revolt"',
            ),
            '"cap-2"',
            'application/json; charset=utf-8',
          ),
    );
    const first = await h.poll();
    const rows = h.db.items.list({ sourceId: 'bbc' });
    // The parser's summary is absent, and the row is publishable: title, link, date.
    expect(rows.every((item) => item.summary === null)).toBe(true);
    expect(rows.some((item) => item.title === HEADLINE)).toBe(true);

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.newItems).toBe(0);
    expect(second.editedItems).toBe(1);
    expect(second.itemCount).toBe(first.itemCount);

    const key = second.editedKeys[0] ?? '';
    const after = h.db.items.find('bbc', key);
    expect(after.title).toContain('restores Claude Code');
    expect(after.editCount).toBe(1);
    expect(after.lastChangedAt).toBe(LATER.toISOString());
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(first.itemCount);
  });

  it('a campaign-tagged copy of a story is the same story: identity is the canonical link', async () => {
    // Rule 6 / D-005: identity is the canonical URL. Core strips `utm_*` and the
    // fragment, and **deliberately keeps** `ref`, `src` and `feature`
    // (`normalize.ts:28-36`), so the test uses the params that are stripped.
    const tagged = '"url": "https://aphyr.com/posts/427-rip-harvest?utm_source=hn&utm_campaign=newsletter"';
    const h = pollHarness(spec, (call) =>
      call === 1
        ? okResponse(fixture(API), '"cap-1"', 'application/json; charset=utf-8')
        : okResponse(
            edited(API, '"url": "https://aphyr.com/posts/427-rip-harvest"', tagged),
            '"cap-2"',
            'application/json; charset=utf-8',
          ),
    );
    const first = await h.poll();

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.newItems).toBe(0);
    expect(second.editedItems).toBe(0);
    expect(second.itemCount).toBe(first.itemCount);
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(first.itemCount);

    const rows = h.db.items.list({ sourceId: 'bbc' }).filter((item) => item.link.includes('aphyr.com'));
    expect(rows).toHaveLength(1);
    // Identity is canonical; the link the reader clicks is the publisher's,
    // tracker and all. One row, one event history.
    expect(rows[0]?.link).toContain('utm_source=hn');
    expect(h.db.itemEvents.listForItem('bbc', rows[0]?.key ?? '')).toHaveLength(1);
  });

  it('and the boundary of that decision: a `?ref=` variant is a different story, on purpose', async () => {
    // Core keeps `ref`/`src`/`feature` because publishers use them to mean
    // something (a syndication copy is not the same edition). Pinned so the
    // day someone "fixes" the stripping, this test says which side was chosen.
    const h = pollHarness(spec, (call) =>
      call === 1
        ? okResponse(fixture(API), '"cap-1"', 'application/json; charset=utf-8')
        : okResponse(
            edited(
              API,
              '"url": "https://aphyr.com/posts/427-rip-harvest"',
              '"url": "https://aphyr.com/posts/427-rip-harvest?ref=feed"',
            ),
            '"cap-2"',
            'application/json; charset=utf-8',
          ),
    );
    const first = await h.poll();

    const second = await h.pollAt(LATER);
    expect(second.newItems).toBe(1);
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe((first.itemCount ?? 0) + 1);
  });

  it('an endpoint that declares no timestamp falls to the body hash, and the counters say so', async () => {
    const h = pollHarness(spec, (call) =>
      okResponse(fixture(API), `"cap-${String(call)}"`, 'application/json; charset=utf-8'),
    );
    const first = await h.poll();

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('same-body');
    expect(second.itemCount).toBeNull();
    expect(second.newItems).toBe(0);

    const state = storedState(h.db, 'bbc');
    expect(state.declaredModifiedAt).toBeNull();
    expect(state.generator).toBeNull();
    expect(state.ttlMinutes).toBeNull();
    expect(state.fastPathHits).toBe(1);
    expect(state.fastPathMisses).toBe(1);
    // The parse was skipped, so no row moved: an unchanged day is not a rewrite.
    expect(h.db.items.list({ sourceId: 'bbc' }).every((item) => item.lastSeenAt === first.takenAt)).toBe(true);
  });
});
