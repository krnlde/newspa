import { describe, expect, it } from 'vitest';
import { selectionHash, selectionText } from '../src/selection.ts';
import { htmlSource, pageSource, rssSource } from './support.ts';

/**
 * The third rung's signal (D-027): the text of the node a source watches, hashed.
 * The pipeline's own test lives in `packages/server/test/poll-html.test.ts` (it
 * needs a poll); what lives here is the **rung's own contract**, including the
 * `null` answers, because a `null` is what keeps a cheap signal from ever
 * suppressing an item.
 */
const page = `<html><body><table><tbody>
  <tr><td>Krakow bridge reopens</td><td>The trams run again. <span class="updated">3 min ago</span><script>track()</script></td><td><a href="/bridge">Read</a></td></tr>
  <tr><td>Ferry timetable slips</td><td>Winter hours begin.</td><td><a href="/ferry">Read</a></td></tr>
</tbody></table></body></html>`;

const rows = htmlSource('tbody tr', { title: 'td:first-child', link: 'td a' }, { strip: ['.updated'] });

describe('the selection signal (D-027)', () => {
  it('is the text of the matched nodes, normalized, so the hash is 8 hex', () => {
    const text = selectionText(page, rows);
    expect(text).not.toBeNull();
    expect(text).toContain('Krakow bridge reopens');
    expect(text).toContain('Ferry timetable slips');
    expect(selectionHash(page, rows)).toMatch(/^[0-9a-f]{8}$/u);
  });

  it('is the text the parser would have read: noise and the source’s own strip are gone', () => {
    const text = selectionText(page, rows);
    // `strip` is the source's list, `NOISE_SELECTOR` the shared one: both are
    // applied before the hash, exactly as `fieldsOfItem` applies them. A hash of
    // text the parser would not have produced fires on the wrong bytes.
    expect(text).not.toContain('3 min ago');
    expect(text).not.toContain('track');
    // The same page with the stamp moved and the words still standing: no new news.
    const stamped = page.replace('>3 min ago<', '>9 minutes ago<');
    expect(selectionHash(stamped, rows)).toBe(selectionHash(page, rows));
    // And a headline that moves does change it: the rung does not swallow news.
    const rewritten = page.replace('Krakow bridge reopens', 'Krakow bridge collapses');
    expect(selectionHash(rewritten, rows)).not.toBe(selectionHash(page, rows));
  });

  it('is `null` when the source has no selection — page mode, a feed: no opinion, never a match', () => {
    expect(selectionText(page, pageSource())).toBeNull();
    expect(selectionText('<rss><channel><item><title>T</title></item></channel></rss>', rssSource())).toBeNull();
  });

  it('is `null` when the selector matched nothing, so a broken selector can never read as "nothing changed"', () => {
    // The rule-5 case: the rung declines and the parse reports `no-matches`.
    const rotted = htmlSource('article.card', { title: 'h2' });
    expect(selectionText(page, rotted)).toBeNull();
    expect(selectionHash(page, rotted)).toBeNull();
  });

  it('is `null` for CSS the engine rejects, where the parse names the fault', () => {
    // The catch has no opinion to trade: it does not decide the poll, and the
    // parse reports `invalid-selector` with the selector that caused it.
    const broken = htmlSource('td:nth-child(', { title: 'td:first-child' });
    expect(selectionText(page, broken)).toBeNull();
  });

  it('is `null` for a node whose text is empty, so an ad slot is not a headline', () => {
    const empty = htmlSource('tbody tr td:last-child', { title: 'td:first-child' });
    const noText = '<html><body><table><tbody><tr><td></td></tr></tbody></table></body></html>';
    expect(selectionText(noText, empty)).toBeNull();
  });
});
