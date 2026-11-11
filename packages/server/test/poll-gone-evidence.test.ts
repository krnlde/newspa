/**
 * Which polls are evidence of a disappearance (D-029).
 *
 * Absence is not a signal, it is the absence of one, so the ladder counts a poll
 * whose item set is **settled**, and a settled set comes two ways:
 *
 *  - the parse ran, over a set that was not cut at `maxItems` — `seen` is what
 *    this poll published;
 *  - a rung skipped the item pass — a `304`, a matching body hash, a matching
 *    **selection hash** — which proved the set **unchanged**. That is the
 *    strongest evidence an absent key gets (*nothing has moved since I showed you
 *    this list*), and without it the rule is unreachable: the polls after a story
 *    leaves are byte-identical, so rung 1 fires forever and the streak freezes at
 *    1. Measured, that is not a corner: the polls after a feed loses its last
 *    entry are `same-body` polls.
 *
 * Not evidence, and never a **reset** either: a transport failure, a parse fault,
 * and a feed cut at its own ceiling. A source that is briefly unreachable retires
 * nothing and reopens nothing; a source that stopped matching reaches the paper as
 * a health state (rule 5), which is exactly why it may not also reach it as a row
 * of closed doors.
 */
import { describe, expect, it } from 'vitest';
import { absentOf, absentOfOne, dropItem, FEED, goneEvents, HTML_TYPE, planFor, served } from './pollGoneSupport.ts';
import { fixture, notModified, okResponse, pollHarness } from './pollSupport.ts';
import { anHtmlSpec, anRssSpec } from './support.ts';

const theFeed = () => fixture(FEED);
/** The feed with its **second** story removed: story 2 leaves, the rest stay. */
const secondGone = () => dropItem(theFeed(), 1);
/** The feed with its **last** story removed, so a list cut at five never saw it. */
const lastGone = () => dropItem(theFeed(), 32);

describe('the polls that count as evidence (D-029)', () => {
  it('a 304 counts: the source is vouching for the list it last showed us', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(secondGone()),
        () => notModified(),
        () => notModified(),
        () => notModified(),
      ),
    );

    await h.poll();
    await h.poll();
    expect(absentOfOne(h).missingStreak).toBe(1);

    // Rung 0 counted, so three quiet polls are enough to close the door: the
    // cadence is the clock, and K is the patience, and both are the point.
    const third = await h.poll();
    expect(third.outcome).toBe('not-modified');
    expect(third.itemCount).toBeNull();
    expect(absentOfOne(h).missingStreak).toBe(2);

    const fourth = await h.poll();
    expect(fourth.outcome).toBe('not-modified');
    expect(fourth.goneItems).toBe(1);
    expect(absentOfOne(h).missingStreak).toBe(3);
    expect(goneEvents(h.db)).toBe(1);

    const fifth = await h.poll();
    expect(fifth.goneItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(4);
    expect(goneEvents(h.db)).toBe(1);
  });

  it('a matching body hash counts, and the snapshot still says it counted no items', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed(), '"cap-1"'),
        () => okResponse(secondGone(), '"cap-2"'),
        () => okResponse(secondGone(), '"cap-3"'),
        () => okResponse(secondGone(), '"cap-4"'),
      ),
    );

    await h.poll();
    await h.poll();
    expect(absentOfOne(h).missingStreak).toBe(1);

    const skipped = await h.poll();
    expect(skipped.outcome).toBe('same-body');
    expect(skipped.itemCount).toBeNull();
    expect(skipped.newItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(2);

    const last = await h.poll();
    expect(last.outcome).toBe('same-body');
    expect(last.goneItems).toBe(1);
    expect(goneEvents(h.db)).toBe(1);
  });

  it('the selection rung counts: a page that only ticks its stripped stamp retires the entry', async () => {
    const spec = anHtmlSpec({
      id: 'bbc',
      list: 'tbody tr',
      strip: ['.updated'],
      fields: { title: 'td:first-child', summary: 'td:nth-child(3)', link: 'td a', body: 'td:nth-child(2)' },
    });
    // One row is one story, and every story needs a link the paper can point at.
    // The stamp is inside a stripped node, so it moves the bytes and nothing
    // else: not the watched node's text, not the item's text.
    const row = (title: string, url: string, stamp: string): string =>
      `<tr><td>${title}</td><td>Winter hours begin.<span class="updated">updated ${stamp}</span></td><td><a href="${url}">Read</a></td></tr>`;
    const page = (stamp: string, withFerry: boolean): string =>
      `<html><body><table><tbody>
${row('Harbour lights restored', 'https://bbc.example/lights', stamp)}
${withFerry ? row('Ferry timetable slips', 'https://bbc.example/ferry', stamp) : ''}
</tbody></table></body></html>`;

    const h = pollHarness(
      spec,
      served(
        () => okResponse(page('09:00', true), '"cap-1"', HTML_TYPE),
        () => okResponse(page('09:10', false), '"cap-2"', HTML_TYPE),
        () => okResponse(page('10:00', false), '"cap-3"', HTML_TYPE),
        () => okResponse(page('11:00', false), '"cap-4"', HTML_TYPE),
      ),
    );

    const first = await h.poll();
    expect(first.itemCount).toBe(2);
    const second = await h.poll();
    expect(second.outcome).toBe('changed');
    expect(absentOfOne(h).missingStreak).toBe(1);

    const third = await h.poll();
    expect(third.outcome).toBe('selection-unchanged');
    expect(third.itemCount).toBeNull();
    expect(absentOfOne(h).missingStreak).toBe(2);

    const fourth = await h.poll();
    expect(fourth.outcome).toBe('selection-unchanged');
    expect(fourth.goneItems).toBe(1);
    expect(goneEvents(h.db)).toBe(1);
  });

  it('announces an absence a `maxItems` window could not see, once the ceiling is wide enough', async () => {
    const h = pollHarness(
      anRssSpec(),
      served(
        () => okResponse(theFeed()),
        () => okResponse(secondGone()),
        () => okResponse(secondGone()),
        () => okResponse(secondGone()),
      ),
    );

    expect((await h.poll()).itemCount).toBeGreaterThan(5);
    await h.poll();
    await h.poll();
    const last = await h.poll();
    expect(last.goneItems).toBe(1);
    expect(goneEvents(h.db)).toBe(1);
  });
});

describe('the polls that are not evidence (D-029)', () => {
  it('a failing poll counts for nothing, and does not reset a streak it was counting', async () => {
    const plan = planFor(
      () => okResponse(theFeed()),
      () => okResponse(secondGone()),
      () => new Response('upstream exploded', { status: 500, statusText: 'Server Error' }),
      () => okResponse(secondGone()),
      () => okResponse(secondGone()),
    );
    const h = pollHarness(anRssSpec(), plan.handler);

    plan.at(0);
    await h.poll();
    plan.at(1);
    await h.poll();
    expect(absentOfOne(h).missingStreak).toBe(1);

    plan.at(2);
    const failed = await h.poll();
    expect(failed.outcome).toBe('error');
    expect(failed.health).toBe('error');
    expect(failed.itemCount).toBeNull();
    expect(failed.goneItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(1);

    // The baseline never moved (a failure writes no state), so the next identical
    // body is rung 1, and the countdown resumes where it stopped.
    plan.at(3);
    await h.poll();
    plan.at(4);
    const last = await h.poll();
    expect(last.outcome).toBe('same-body');
    expect(last.goneItems).toBe(1);
    expect(absentOfOne(h).missingStreak).toBe(3);
  });

  it('a page that stops matching is a health state, not a row of closed doors', async () => {
    // The contract is what makes the fault loud: `matchCount: 2` is the reader
    // saying "this node has two entries", so a page that answers with nothing is
    // `no-matches` (D-026). A source with no contract has nothing to compare 0
    // against, and its state is `unknown` — which is also a strip, not a silence.
    const spec = anHtmlSpec({
      id: 'bbc',
      list: 'tbody tr',
      matchCount: 2,
      fields: { title: 'td:first-child', summary: 'td:nth-child(3)', link: 'td a' },
    });
    const row = (title: string, url: string): string =>
      `<tr><td>${title}</td><td>Winter hours.</td><td><a href="${url}">Read</a></td></tr>`;
    const page = (rows: string): string => `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
    const both = page(
      row('Ferry timetable slips', 'https://bbc.example/ferry') + row('Harbour lights', 'https://bbc.example/lights'),
    );
    const one = page(row('Harbour lights', 'https://bbc.example/lights'));
    // The same news, in new markup: the redesign kept the words and dropped the
    // table. The bytes moved, so rung 1 declines; the watched node matches
    // nothing, so rung 2 has no opinion (a `null` never matches, D-027) — and the
    // parse reports the fault, which is the state the paper prints.
    const redesign = (): string =>
      '<html><body><div class="stories"><p>Ferry timetable slips</p><p>Harbour lights</p></div></body></html>';

    const h = pollHarness(
      spec,
      served(
        () => okResponse(both, '"cap-1"', HTML_TYPE),
        () => okResponse(one, '"cap-2"', HTML_TYPE),
        () => okResponse(redesign(), '"cap-3"', HTML_TYPE),
      ),
    );

    expect((await h.poll()).itemCount).toBe(2);
    await h.poll();
    expect(absentOfOne(h).missingStreak).toBe(1);

    const broken = await h.poll();
    expect(broken.outcome).toBe('error');
    expect(broken.health).toBe('no-matches');
    expect(broken.itemCount).toBe(0);
    expect(broken.goneItems).toBe(0);
    expect(absentOfOne(h).missingStreak).toBe(1);
    expect(goneEvents(h.db)).toBe(0);
  });

  it('a feed cut at `maxItems` has no opinion: the front of the list is not the list', async () => {
    const h = pollHarness(
      anRssSpec({ maxItems: 5 }),
      served(
        () => okResponse(theFeed()),
        () => okResponse(secondGone()),
        () => okResponse(secondGone()),
        () => okResponse(secondGone()),
      ),
    );

    expect((await h.poll()).itemCount).toBe(5);
    const second = await h.poll();
    await h.poll();
    // Story 2 was in the first poll's five and is in none of these. The paper
    // says nothing: a cut poll cannot see past its own ceiling — and the window
    // simply closes over it (five of the remaining stories are published), which
    // is the shape of a feed that shuffles its front page.
    expect(second.outcome).toBe('changed');
    expect(second.itemCount).toBe(5);
    expect(second.goneItems).toBe(0);
    expect(absentOf(h)).toEqual([]);
    expect(goneEvents(h.db)).toBe(0);
  });

  it('a story that was never in the window cannot leave it: a shuffling cut manufactures nothing', async () => {
    const h = pollHarness(
      anRssSpec({ maxItems: 5 }),
      served(
        () => okResponse(theFeed()),
        () => okResponse(lastGone()),
        () => okResponse(lastGone()),
      ),
    );

    await h.poll();
    const second = await h.poll();
    expect(second.itemCount).toBe(5);
    expect(second.goneItems).toBe(0);
    const third = await h.poll();
    expect(third.outcome).toBe('same-body');
    expect(third.goneItems).toBe(0);
    expect(absentOf(h)).toEqual([]);
  });
});
