/**
 * The disappearance ladder (D-029, level 1) as the poll runs it: a **known** key
 * stops appearing, and after K complete, successful polls the paper says so
 * **once**.
 *
 * Core owns the arithmetic and `packages/core` pins it; the db owns the columns
 * and `packages/db` pins them. What is pinned here is the composition the paper
 * is judged on: the count moves one per poll, the announcement is one
 * `item_events` row built from the **stored** item (the story is not in this
 * poll, so there is nothing fresh to say about it), the streak keeps counting
 * afterwards without announcing twice, and a key that returns is **reopened** —
 * the row, its title, its link and its place in the paper are untouched, because
 * the slot is a door left open, not a tombstone.
 *
 * "Which polls are evidence" is the other half, and it is
 * `poll-gone-evidence.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  absentOf,
  absentOfOne,
  archivedCards,
  CARDS,
  cardsSpec,
  dropItem,
  FEED,
  goneEvents,
  HTML_TYPE,
  SOURCE,
  served,
} from './pollGoneSupport.ts';
import { fixture, okResponse, pollHarness, TAKEN_AT } from './pollSupport.ts';
import { anRssSpec } from './support.ts';

/** The feed, and the feed after the last of its stories left the list. */
const theFeed = () => fixture(FEED);
const closedFeed = () => dropItem(theFeed(), 32);

describe('the disappearance ladder in the poll (D-029)', () => {
  it('is silent on the first poll: nothing is stored, so nothing can be absent', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(() => okResponse(theFeed())),
    );
    const first = await h.poll();

    expect(first.itemCount).toBeGreaterThan(0);
    expect(first.goneItems).toBe(0);
    expect(first.goneKeys).toEqual([]);
    expect(goneEvents(h.db)).toBe(0);
    expect(absentOf(h)).toEqual([]);
  });

  it('counts the absence, and says nothing until the Kth complete poll', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
      ),
    );

    await h.poll();
    const first = await h.poll();
    expect(first.goneItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(1);
    expect(goneEvents(h.db)).toBe(0);

    const second = await h.poll();
    expect(second.goneItems).toBe(0);
    expect(second.newItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(2);
    expect(goneEvents(h.db)).toBe(0);
  });

  it('announces the Kth absence once, with the key, the count and one `gone` event', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
      ),
    );

    await h.poll();
    await h.poll();
    await h.poll();
    const third = await h.poll();

    expect(third.goneItems).toBe(1);
    expect(third.goneKeys).toHaveLength(1);
    expect(goneEvents(h.db)).toBe(1);

    const key = third.goneKeys[0] ?? '';
    const [event] = h.db.itemEvents.listForItem(SOURCE, key);
    // The item is not in this poll, so the event speaks with the stored row: the
    // last thing the paper knew is the honest subject of the line.
    const stored = h.db.items.find(SOURCE, key);
    expect(event?.kind).toBe('gone');
    expect(event?.at).toBe(TAKEN_AT);
    expect(event?.title).toBe(stored.title);
    expect(event?.link).toBe(stored.link);
    expect(event?.report).toBeNull();
  });

  it('keeps counting after the door closes, and never announces it twice', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
      ),
    );

    await h.poll();
    await h.poll();
    await h.poll();
    expect((await h.poll()).goneItems).toBe(1);

    const fifth = await h.poll();
    expect(fifth.goneItems).toBe(0);
    expect(fifth.goneKeys).toEqual([]);
    expect(absentOfOne(h).missingStreak).toBe(4);
    expect(goneEvents(h.db)).toBe(1);
  });

  it('reopens the slot when the key comes back, and clears the stamp', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(theFeed()),
      ),
    );

    await h.poll();
    await h.poll();
    await h.poll();
    const announced = await h.poll();
    expect(announced.goneItems).toBe(1);
    const key = announced.goneKeys[0] ?? '';
    expect(h.db.items.storedKeys(SOURCE).find((row) => row.key === key)?.goneAt).toBe(TAKEN_AT);

    const back = await h.poll();
    expect(back.goneItems).toBe(0);
    const row = h.db.items.storedKeys(SOURCE).find((r) => r.key === key);
    expect(row?.missingStreak).toBe(0);
    expect(row?.goneAt).toBeNull();
    // One door, one announcement: reopening is a reopening, not an event.
    expect(goneEvents(h.db)).toBe(1);
  });

  it('leaves the row standing: a closed door keeps its story, its link and its place', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
        () => okResponse(closedFeed()),
      ),
    );

    const before = (await h.poll()).itemCount ?? 0;
    await h.poll();
    await h.poll();
    const announced = await h.poll();
    const key = announced.goneKeys[0] ?? '';

    // Nothing is deleted, and nothing is marked dead: the paper keeps polling the
    // source, and the link the reader has open in a tab still opens.
    expect(h.db.items.count({ sourceId: SOURCE })).toBe(before);
    const row = h.db.items.find(SOURCE, key);
    expect(row.title.length).toBeGreaterThan(0);
    expect(row.link.startsWith('https://')).toBe(true);
    expect(h.db.itemEvents.listForItem(SOURCE, key).map((event) => event.kind)).toEqual(['gone', 'new']);
  });

  it('closes the slot of an html page whose newest entry moved on (the archive case)', async () => {
    const h = pollHarness(
      cardsSpec(),
      served(
        () => okResponse(fixture(CARDS), '"cap-1"', HTML_TYPE),
        () => okResponse(archivedCards(), '"cap-2"', HTML_TYPE),
        () => okResponse(archivedCards(), '"cap-3"', HTML_TYPE),
        () => okResponse(archivedCards(), '"cap-4"', HTML_TYPE),
      ),
    );

    await h.poll();
    await h.poll();
    await h.poll();
    const third = await h.poll();

    expect(third.goneItems).toBe(1);
    const [event] = h.db.itemEvents.listForItem(SOURCE, third.goneKeys[0] ?? '');
    expect(event?.kind).toBe('gone');
    expect(event?.title).toBe('Second story');
  });
});
