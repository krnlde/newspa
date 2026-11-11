import type { CheerioAPI } from 'cheerio';
import { describe, expect, it } from 'vitest';
import type { NodeSet } from '../src/htmlSelectors.ts';
import { loadDocument } from '../src/htmlSelectors.ts';
import {
  chainOf,
  classCandidates,
  classesOf,
  climbCandidates,
  positionalCandidates,
  stepsOfSiblings,
} from '../src/pick/cssPath.ts';
import { deriveFields } from '../src/pick/deriveFields.ts';
import { parseFingerprint } from '../src/pick/fingerprint.ts';
import { generalize } from '../src/pick/generalize.ts';
import { tagOf } from '../src/pick/mapPath.ts';
import { describePickRun, type PickRun } from '../src/pick/pickSession.ts';
import { fixture } from './support.ts';

/**
 * The picker's small parts, tested where they live (WP6).
 *
 * The loop tests (`pickDerive`, `pickSession`, `test/browser/`) drive the whole
 * sequence. These are the arms the sequence cannot reach, and each is a claim about
 * a rule the ladder depends on:
 *
 *  - the class filter: a Tailwind name is not a CSS selector, so it is skipped;
 *  - the candidate list: a string the CSS engine rejects is skipped, and when every
 *    candidate is rejected the refusal is **named**, not swallowed by the throw;
 *  - a node with no tag (`<html>`, the document) reads as `''`, and the ladder
 *    survives it;
 *  - `describePickRun` prints the shape the reader is promised: the positional word,
 *    the omitted `fields.link`, the notes, and a fault with no notes.
 */

const doc = (html: string): CheerioAPI => loadDocument(html);

describe('the class filter, on the names publishers ship', () => {
  const $ = doc(fixture('pick-class-hooks.html'));
  const clicked = $('.feed > li').eq(1);

  it('keeps the safe hook, drops the utility classes', () => {
    expect(classesOf(clicked)).toEqual(['item']);
    expect(classCandidates(clicked)).toEqual(['.item', 'li.item']);
  });

  it('lands on the safe hook, and never on a utility class name', () => {
    const run = generalize($, clicked, clicked.parent().children() as NodeSet, [
      { tag: 'html', index: 1 },
      { tag: 'body', index: 2 },
      { tag: 'div', index: 1 },
      { tag: 'ul', index: 1 },
    ]);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // `.item` describes the set exactly, so the ladder stops there: a class hook
    // beats an ancestor chain, and the chain is only reached when no hook does.
    expect(run.list).toBe('.item');
    expect(run.positional).toBe(false);
    expect(run.list).not.toContain('md:top-0');
    expect(run.list).not.toContain('p-[0.3rem]');
  });

  it('the ancestor-anchored chain is what the climb proposes, when it is reached', () => {
    expect(
      climbCandidates(
        [
          { tag: 'html', index: 1 },
          { tag: 'body', index: 2 },
        ],
        'li',
      ),
    ).toEqual(['html > body:nth-child(2) > li', 'html > li']);
  });

  it('the ladder builders spell the chain, and the positional pair joins a set', () => {
    expect(
      chainOf([
        { tag: 'html', index: 1 },
        { tag: 'body', index: 2 },
      ]),
    ).toBe('html > body:nth-child(2)');
    expect(climbCandidates([{ tag: 'html', index: 1 }], 'li')).toEqual(['html > li']);
    const joined = positionalCandidates(
      [{ tag: 'html', index: 1 }],
      [
        { tag: 'li', index: 1 },
        { tag: 'h2', index: 2 },
      ],
    );
    expect(joined[0]).toBe('html > li:nth-child(1), html > h2:nth-child(2)');
    expect(joined[1]).toBe('html > li:nth-child(1), html > h2:nth-child(2)');
    expect(stepsOfSiblings($('li').first().parent().children() as NodeSet).length).toBeGreaterThan(0);
  });

  it('a node with no class yields no candidates, and survives the ladder', () => {
    const $bare = doc('<html><body><p>One</p><p>Two</p></body></html>');
    expect(classesOf($bare('p').first())).toEqual([]);
    expect(classCandidates($bare('p').first())).toEqual([]);
  });
});

describe('the candidate list, when the engine rejects every one', () => {
  it('refuses a set the fetched document does not contain, and names it', () => {
    // Identity is the test, so a set from another document cannot match: this is
    // the refusal's honest arm, and the sentence is what the reader would need.
    const $here = doc('<html><body><div>One</div><div>Two</div></body></html>');
    const $there = doc('<html><body><section><p>One</p><p>Two</p></section></body></html>');
    const run = generalize($here, $there('p').eq(0), $there('section').children() as NodeSet, [
      { tag: 'html', index: 1 },
      { tag: 'body', index: 2 },
      { tag: 'section', index: 1 },
    ]);
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe('generalize-failed');
    expect(run.detail).toContain('2 nodes');
    expect(run.notes.join(' ')).toContain('write a selector by hand');
  });

  it('a node with no tag reads as an empty string, not a crash', () => {
    const $ = doc('<html><body><p>One</p></body></html>');
    expect(tagOf($.root() as NodeSet)).toBe('');
    expect(tagOf($('p').first())).toBe('p');
  });
});

describe('the fields, on a set that has links and no words', () => {
  it('refuses a set with no title, and names what it tried', () => {
    const $ = doc(fixture('pick-no-title.html'));
    const items = $('.item')
      .toArray()
      .map((_, at) => $('.item').eq(at) as NodeSet);
    const run = deriveFields(items, 1);
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe('no-title');
    expect(run.detail).toContain('h1');
  });

  it('reads the set where the item IS the link, and writes no fields.link', () => {
    const $ = doc(fixture('pick-item-is-link.html'));
    const items = $('a.card')
      .toArray()
      .map((_, at) => $('a.card').eq(at) as NodeSet);
    const run = deriveFields(items, 2);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.fields).toEqual({ title: 'a' });
    expect(run.sample.link).toBe('/l2');
    expect(run.notes.join(' ')).toContain('fields.link is not written');
  });

  it('an index past the set is a named refusal', () => {
    const $ = doc(fixture('pick-no-title.html'));
    const items = $('.item')
      .toArray()
      .map((_, at) => $('.item').eq(at) as NodeSet);
    const run = deriveFields([], 1);
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.reason).toBe('not-a-list');
    expect(items.length).toBe(3);
  });
});

describe('the sentence the CLI and the page print', () => {
  const success: Extract<PickRun, { ok: true }> = {
    ok: true,
    stage: 'derived',
    fp: {
      url: 'https://example.invalid/world',
      path: [{ tag: 'html', index: 1 }],
      href: null,
      outerHtml: '<li>One</li>',
      text: 'One',
      siblings: 2,
    },
    outcome: {
      ok: true,
      list: 'section > article:nth-child(1), section > h2:nth-child(2)',
      fields: { title: 'a' },
      matchCount: 4,
      positional: true,
      sample: { title: 'Story one', link: '/w1', summary: '' },
      notes: ['the selector is positional (:nth-child): it holds while the page keeps this shape'],
    },
  };

  it('says the positional word, and the field it did not write', () => {
    const printed = describePickRun(success, { url: 'https://example.invalid/world' });
    expect(printed).toContain('(positional)');
    expect(printed).toContain('fields     title: a');
    expect(printed).toContain('note       the selector is positional');
    expect(printed).toContain('reads      "Story one" -> /w1');
  });

  it('prints a fault with no notes as one clean block', () => {
    const bare: Extract<PickRun, { ok: false }> = {
      ok: false,
      stage: 'launch',
      reason: 'timed-out',
      detail: 'no click within 5 s',
      notes: [],
    };
    const printed = describePickRun(bare, { url: 'https://example.invalid/x', label: 'X' });
    expect(printed).toBe(
      'pick wrote nothing for X (https://example.invalid/x): launch / timed-out\n  no click within 5 s',
    );
  });
});

describe("the boundary's own caps", () => {
  it('refuses a tag that is not an element name', () => {
    const parsed = parseFingerprint({
      url: 'https://example.invalid/world',
      path: [{ tag: 'div'.repeat(20), index: 1 }],
      href: null,
      outerHtml: '<x/>',
      text: 'x',
      siblings: 2,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain('path[0].tag');
  });

  it('refuses an empty tag, and a path whose first step is not html', () => {
    const empty = parseFingerprint({
      url: 'https://example.invalid/world',
      path: [{ tag: '   ', index: 1 }],
      href: null,
      outerHtml: '<x/>',
      text: 'x',
      siblings: 2,
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.detail).toContain('path[0].tag');
  });
});
