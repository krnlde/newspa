/**
 * The diff, and the events it produces: a story that moved must arrive as one
 * row with an `edited` event and a report, and a story that did not move must
 * not claim it did.
 *
 * The identity rule makes these tests worth reading: the key is the **canonical
 * link**, not the title, so a publisher who rewrites a headline produces an
 * edit of the same story — not a new story, and not two. And the upsert's
 * arithmetic belongs to the repository: `edit_count` is **added** and
 * `last_changed_at` keeps its first value, so a poll that writes an unchanged
 * row must hand it its own instant back, never `takenAt`.
 */
import type { Database, ItemRecord } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { edited, fixture, okResponse, type PollHarness, pollHarness, TAKEN_AT } from './pollSupport.ts';
import { anRssSpec, healthOfSource, stateOfDb, wireItems } from './support.ts';

const FEED = 'feed-bbc-world.xml';
const STAMP = 'Mon, 09 Nov 2026 12:46:39 GMT';
const LATER = new Date('2026-11-09T11:00:00.000Z');
const KRAKOW = 'Krakow shooting suspect has died in hospital, police say';

/**
 * A second version of the capture: the story changed **and** the feed says so.
 *
 * The re-stamp is decoration — the declared timestamp is **recorded, never
 * obeyed** (D-027). A publisher that stamps its feed once a day and edits it
 * hourly has those intraday edits parsed, which is the point of the test that
 * used to name the boundary; every test here is about what the parse publishes
 * once it runs.
 */
const restamped = (find: string, replace: string) => () =>
  okResponse(fixture(FEED).replace(STAMP, 'Tue, 10 Nov 2026 08:00:00 GMT').replace(find, replace), '"cap-2"');

/** The handler: the capture first, then the same feed with one story changed. */
const twice = (spec: ReturnType<typeof anRssSpec>, find: string, replace: string): PollHarness => {
  const h = pollHarness(spec, (call) => (call === 1 ? okResponse(fixture(FEED)) : restamped(find, replace)()));
  return h;
};

const story = (db: Database, key: string): ItemRecord => db.items.find('bbc', key);

/**
 * The key of the story with **exactly** this title.
 *
 * Exact, not a pattern: the capture carries two headlines about the same
 * shooting, and a loose match would pick the other story and make an honest
 * test fail. Requiring exactly one row is also the point — the poll must not
 * write the same story twice.
 */
const keyOfTitle = (db: Database, title: string): string => {
  const rows = db.items.list({ sourceId: 'bbc' }).filter((item) => item.title === title);
  const first = rows[0];
  if (rows.length !== 1 || first === undefined) throw new Error(`${title}: ${String(rows.length)} rows, expected 1`);
  return first.key;
};

describe('an edited story is one row, with a report', () => {
  it('a rewritten headline edits the same story, and carries the report', async () => {
    const h = twice(anRssSpec(), KRAKOW, 'French pension reform passes second reading in the Senate');
    const before = await h.poll();
    const key = keyOfTitle(h.db, KRAKOW);
    expect(before.newKeys).toContain(key);

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.newItems).toBe(0);
    expect(second.editedItems).toBe(1);
    expect(second.editedKeys).toEqual([key]);

    const row = story(h.db, key);
    expect(row.title).toContain('pension reform');
    // The key survived the rewrite, so the story is the same story.
    expect(row.key).toBe(key);
    expect(row.firstSeenAt).toBe(TAKEN_AT);
    expect(row.lastSeenAt).toBe(LATER.toISOString());
    expect(row.lastChangedAt).toBe(LATER.toISOString());
    expect(row.editCount).toBe(1);

    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'edited' })).toBe(1);
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'new' })).toBe(before.itemCount);
    // One row per story: the rewrite did not add a second copy.
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(before.itemCount);

    // The event log is the story's history: it appeared, then it moved.
    const events = h.db.itemEvents.listForItem('bbc', key);
    expect(events.map((event) => event.kind)).toEqual(['edited', 'new']);
    expect(events[0]?.report).not.toBeNull();
    expect(events[0]?.report?.ops.length).toBeGreaterThan(0);
    expect(events[0]?.at).toBe(LATER.toISOString());
    expect(events[1]?.report).toBeNull();
    expect(events[1]?.at).toBe(TAKEN_AT);
  });

  it('a rewritten paragraph is an edit too, and the other stories stay untouched', async () => {
    const h = twice(
      anRssSpec(),
      "Six people were killed in the shooting, and three bodies of the suspect's family members were found at their home.",
      'Officials say the investigation has widened to three nearby towns.',
    );
    const first = await h.poll();

    const second = await h.pollAt(LATER);
    expect(second.editedItems).toBe(1);
    expect(second.newItems).toBe(0);

    const editedKey = second.editedKeys[0] ?? '';
    expect(story(h.db, editedKey).lastChangedAt).toBe(LATER.toISOString());
    // The rows that did not move must not claim they did.
    const untouched = h.db.items.list({ sourceId: 'bbc' }).filter((item) => item.key !== editedKey);
    expect(untouched.length).toBeGreaterThan(3);
    expect(untouched.every((item) => item.lastChangedAt === null)).toBe(true);
    expect(untouched.every((item) => item.editCount === 0)).toBe(true);
    // "Seen" and "changed" are different columns: the parse ran, so every story
    // was seen again, and only one of them changed.
    expect(untouched.every((item) => item.lastSeenAt === LATER.toISOString())).toBe(true);
    expect(untouched.every((item) => item.firstSeenAt === TAKEN_AT)).toBe(true);
    expect(first.itemCount).toBe(untouched.length + 1);
  });

  it('a punctuation change under the source’s ratio is not an edit', async () => {
    const h = twice(anRssSpec({ minEditRatio: 0.2 }), KRAKOW, `${KRAKOW}.`);
    await h.poll();
    const key = keyOfTitle(h.db, KRAKOW);

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.editedItems).toBe(0);
    expect(second.newItems).toBe(0);

    const row = story(h.db, key);
    expect(row.title).toBe(`${KRAKOW}.`);
    expect(row.lastChangedAt).toBeNull();
    expect(row.editCount).toBe(0);
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'edited' })).toBe(0);
    // The story was seen again, so the poll stamped it: "seen" and "changed" are
    // different columns, and the paper's "new since you last looked" reads them.
    expect(row.lastSeenAt).toBe(LATER.toISOString());
  });

  it('the ratio is the source’s knob: a strict source records no edits', async () => {
    // `minEditRatio: 1` means "only a wholesale rewrite counts". The headline is
    // replaced, similarity is not zero, so a strict source stays quiet.
    const h = twice(
      anRssSpec({ minEditRatio: 1 }),
      KRAKOW,
      'French pension reform passes second reading in the Senate',
    );
    await h.poll();

    expect((await h.pollAt(LATER)).editedItems).toBe(0);
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'edited' })).toBe(0);
  });

  it('an edit the feed does not declare is parsed (D-027: the stamp records, it never suppresses)', async () => {
    // The same story, rewritten, with `<lastBuildDate>` left where it was. Under
    // the rung this test used to pin, the poll answered `declared-unchanged`, the
    // rewrite stayed invisible until the stamp moved, and the paper printed a
    // stale headline. The declared stamp is a **note** now; the news is parsed.
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1
        ? okResponse(fixture(FEED))
        : okResponse(edited(FEED, KRAKOW, 'A headline nobody will read'), '"cap-2"'),
    );
    const first = await h.poll();
    expect(first.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    // The key is the canonical link, so the row survives its own rewrite.
    const key = keyOfTitle(h.db, KRAKOW);

    const second = await h.pollAt(LATER);
    expect(second.outcome).toBe('changed');
    expect(second.editedKeys).toEqual([key]);
    expect(story(h.db, key).title).toBe('A headline nobody will read');
  });

  it('a story the feed adds is a `new` event, and the rest stay `new`-of-the-first-poll', async () => {
    const extra = `<item>
            <title><![CDATA[Brand new story for the paper]]></title>
            <description><![CDATA[The newest thing to happen, reported first here.]]></description>
            <link>https://bbc.example/story/brand-new</link>
            <guid isPermaLink="false">https://bbc.example/story/brand-new</guid>
            <pubDate>Mon, 09 Nov 2026 09:30:00 GMT</pubDate>
        </item>
        <item>`;
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1
        ? okResponse(fixture(FEED))
        : okResponse(
            fixture(FEED).replace(STAMP, 'Tue, 10 Nov 2026 08:00:00 GMT').replace('        <item>', extra),
            '"cap-2"',
          ),
    );
    const first = await h.poll();

    const second = await h.pollAt(LATER);
    expect(second.newItems).toBe(1);
    expect(second.editedItems).toBe(0);
    expect(second.itemCount).toBe((first.itemCount ?? 0) + 1);
    const key = keyOfTitle(h.db, 'Brand new story for the paper');
    const row = story(h.db, key);
    expect(row.firstSeenAt).toBe(LATER.toISOString());
    expect(row.lastChangedAt).toBeNull();
    expect(row.editCount).toBe(0);
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'new' })).toBe(second.itemCount);
  });

  it('`read_at` and `first_seen_at` survive a re-poll: they are the reader’s, not the poll’s', async () => {
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1 ? okResponse(fixture(FEED)) : restamped(KRAKOW, 'A rewritten headline')(),
    );
    await h.poll();
    const key = keyOfTitle(h.db, KRAKOW);
    const READ_AT = new Date('2026-11-09T10:30:00.000Z').toISOString();
    h.db.items.setRead('bbc', key, READ_AT);

    await h.pollAt(LATER);
    const row = story(h.db, key);
    expect(row.readAt).toBe(READ_AT);
    expect(row.firstSeenAt).toBe(TAKEN_AT);
  });

  it('the paper prints the edit: the count, the event kind, and the report', async () => {
    const h = twice(anRssSpec(), KRAKOW, 'French pension reform passes second reading in the Senate');
    await h.poll();
    const second = await h.pollAt(LATER);

    const state = stateOfDb(h.db);
    const view = wireItems(state).find((item) => item.key === second.editedKeys[0]);
    expect(view).toBeDefined();
    expect(view?.lastEventKind).toBe('edited');
    expect(view?.lastReport?.ops.length).toBeGreaterThan(0);
    expect(state.edition.stats.editedItems).toBe(1);
    expect(state.edition.stats.items).toBe(second.itemCount);

    // An edit is not a fault: the source is reporting, so the health strip stays empty.
    expect(healthOfSource(state, 'bbc').state).toBe('ok');
    expect(state.edition.stats.sourcesUnhealthy).toBe(0);
  });
});
