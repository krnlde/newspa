import type { PickedItem } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { parseHtmlPayload } from '../src/html.ts';
import { fieldsOfItem, loadDocument } from '../src/htmlSelectors.ts';
import { absoluteLink } from '../src/item.ts';
import type { ParseFailure } from '../src/results.ts';
import { parseRssPayload } from '../src/rss.ts';
import { imageOf } from '../src/rssFields.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, htmlSource, itemAt, okItems, rssSource } from './support.ts';

/**
 * Measured gaps, executable. Each test below asserts what the parser **must**
 * do, and each one whose assertion the shipped code does not satisfy is wrapped
 * in `it.fails` — the way a documented defect stays runnable without turning
 * the suite red (AGENTS.md rule 14: a failing test is a report). The measured
 * answer for every case is in the comment beside it, and the fixtures say the
 * same in their own provenance block.
 *
 * Three of the five cases are about the image an item carries: the `<picture>`
 * element (open item, `docs/decisions-detection.md`), the order the feed's
 * image tags are read in, and D-032's image rule (a URL whose shape is a
 * query-string blob yields `image: null`). The fourth, D-026's `multi-match`
 * fault, is **closed** — `src/html.ts` answers the fault now, so that block is
 * a plain `it`. The fifth, D-030's link base, is only half in this package —
 * see the last block.
 */

const htmlItems = (name: string, overrides: Record<string, unknown> = {}): readonly PickedItem[] => {
  const text = fixture(name);
  return okItems(parseHtmlPayload(text, htmlSource('li.card', { title: '.title' }, overrides), sniff(text)));
};

const rssItems = (name: string): readonly PickedItem[] => {
  const text = fixture(name);
  return okItems(parseRssPayload(text, rssSource(), sniff(text)));
};

/**
 * The fault's reason as plain text. `ParseFailureReason` (`src/results.ts`) has
 * the `multi-match` member now, and its health half is `server/src/pollHealth.ts`
 * (any reason that is not `kind-mismatch` / `no-matches` / `challenge` becomes
 * `errorKind: 'parse'`, and core maps `'parse'` to health `error`), so this
 * widening to `string` is only the shorthand that keeps the assertion literal.
 */
const reasonOf = (failure: ParseFailure): string => failure.reason;

describe('a `<picture>` element is image evidence (open item, decisions-detection.md)', () => {
  it('reads the `img` of a card that ships no picture, the arm that works today', () => {
    expect(itemAt(htmlItems('html-picture.html'), 1).image).toBe('https://example.invalid/b-800.jpg');
  });

  it.fails('takes the 2x candidate of a `<picture>` `<source srcset>`, not the fallback `img src`', () => {
    // Gap: `NOISE_SELECTOR` (`src/htmlText.ts`) strips `picture` and `source`
    // from the clone `fieldsOfItem` reads, so the srcset is gone **before**
    // `imageFrom` runs. Measured today: `image` is `null` on this card, at the
    // selector layer and at the item.
    const card = loadDocument(fixture('html-picture.html'))('li.card').eq(0);
    const spec = htmlSource('li.card', { title: '.title' });
    expect(fieldsOfItem(card, spec).image).toBe('https://example.invalid/a-2x.jpg');
    expect(itemAt(htmlItems('html-picture.html'), 0).image).toBe('https://example.invalid/a-2x.jpg');
  });

  it.fails('resolves a root-relative srcset inside a `<picture>` against the source url', () => {
    // Same gap, and the resolution it has to come through: an image URL on a
    // `PickedItem` is `absoluteLink`ed, so the wanted answer is absolute.
    expect(itemAt(htmlItems('html-picture.html'), 2).image).toBe('https://example.invalid/pics/c-2x.webp');
  });
});

describe('the feed image is the story image, not the avatar (D-032)', () => {
  it('prefers the 256px `media:content` over the 30×30 `media:thumbnail` written before it', () => {
    // True today, and worth pinning: `mediaImage` tries `media:content` first,
    // so document order does not decide. D-032 asks for exactly this answer.
    expect(itemAt(rssItems('rss-media-images.xml'), 0).image).toBe('https://example.invalid/story-256px.jpg');
  });

  it('takes the 30×30 avatar when it is the only image evidence, which is GitHub atom today', () => {
    // No size rule exists, and none is decided: the entry has a thumbnail and
    // nothing else, so the avatar is the image. The `&` shows the entity in an
    // attribute value arriving decoded (`absoluteLink`), not as `&amp;`.
    expect(itemAt(rssItems('rss-media-images.xml'), 1).image).toBe(
      'https://avatars.githubusercontent.com/in/15368?s=60&v=4',
    );
  });

  it.fails('answers `image: null` for a URL whose shape is a query-string blob (D-032)', () => {
    // Gap: D-032's image rule is a **validation** rule — a URL with no path
    // extension and a query is not an image, and `null` is the statement the
    // paper can print (rule 5: never a 404 in an `<img>`). Measured today: the
    // blob URL is the item's image.
    expect(itemAt(rssItems('rss-media-images.xml'), 2).image).toBeNull();
  });

  it.fails('the rule is the ladder’s, so `imageOf` answers null for the same shape', () => {
    // Pinning where the fix belongs: every parser (feed, HTML, JSON) reads an
    // image through a ladder, so the shape rule belongs there and not in a
    // caller. Measured today: the URL is returned verbatim.
    expect(
      imageOf({ 'media:content': { '@_url': 'https://example.invalid/refs?tag_name=v0.2.13&experimental=1' } }),
    ).toBeNull();
  });
});

describe('a selector that matches more nodes than the source recorded is a fault (D-026)', () => {
  it('10 nodes against a recorded 1 is `multi-match`, naming the selector and both counts', () => {
    // D-026 is the reader's rule — one HTML source is one subscription to "the
    // newest thing on this page" — and `parseHtmlPayload` enforces it: when the
    // selector matches more nodes than the source recorded, it answers the
    // `multi-match` fault **before** mapping any item, so `itemCount` is 0 and
    // the detail names the selector and both counts. A fault is the only route
    // to the strip: core's `classifyFetch` flags an **under**-count
    // (`itemCount / expected < 0.6`) only, so 10 items for a recorded 1 was `ok`
    // in health, and `server/src/pollHealth.ts` maps a **fault's** reason to the
    // `errorKind` — `multi-match` is none of `kind-mismatch` / `no-matches` /
    // `challenge`, so it becomes `parse`, and core maps `parse` to health
    // `error`. The payload is inline (not a fixture) because the shape is a
    // count, and a generated list of identical cards is not a payload worth
    // pinning.
    const payload = `<html><body><ul>${Array.from(
      { length: 10 },
      (_, index) =>
        `<li class="card"><h2 class="title">Story ${String(index)}</h2><a href="/story/${String(index)}">Read</a></li>`,
    ).join('')}</ul></body></html>`;
    const failure = failed(
      parseHtmlPayload(payload, htmlSource('li.card', { title: '.title' }, { matchCount: 1 }), sniff(payload)),
    );
    expect(reasonOf(failure)).toBe('multi-match');
    expect(failure.cause).toBe('li.card');
    expect(failure.matchCount).toBe(10);
    expect(failure.itemCount).toBe(0);
    // The count pair is the actionable part, in the words `collectNodes`
    // already uses for the other half of the same signal.
    expect(failure.detail).toContain('matched 10 elements; the source recorded 1 when it was picked');
  });
});

describe('the link base is the URL that answered (D-030)', () => {
  it('resolves a root-relative href against whatever base it is handed', () => {
    // The resolver is correct — D-030's measured bug is the **base**. That is
    // why the gap itself is not pinned in this package: `buildItem` passes
    // `spec.url` (`src/item.ts`), no parse entry point takes a final URL, and
    // `packages/server/src/poll.ts` discards the `FetchResponse.url` the
    // transport already records. Pinning the wanted answer needs a parameter on
    // `parsePayload`/`parseHtmlPayload` **and** the pipeline that has the
    // response, so it is reported, not asserted.
    expect(absoluteLink('/world/x', 'https://cdn.example.com/news/index')).toBe('https://cdn.example.com/world/x');
  });

  it('is `spec.url` today, so a payload served from a cdn gets the recorded host', () => {
    // What D-030 calls the bug, stated as a fact: the item's text is from the
    // payload, its link is from the old place. A permanent redirect therefore
    // costs every poll a hop and prints a link that 404s once the host dies.
    const payload =
      '<html><body><ul><li class="card"><h2 class="title">Served by the cdn</h2><a href="/world/x">Read</a></li></ul></body></html>';
    const spec = htmlSource('li.card', { title: '.title' }, { url: 'https://old.example.com/news' });
    expect(itemAt(okItems(parseHtmlPayload(payload, spec, sniff(payload))), 0).link).toBe(
      'https://old.example.com/world/x',
    );
  });
});
