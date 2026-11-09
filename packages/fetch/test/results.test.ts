import type { PickedItem } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { failWith, skipNotes, succeed } from '../src/results.ts';
import { leadIn } from '../src/sniff.ts';

/**
 * The result shape every parser returns. The default arms of `succeed` and
 * `failWith` are what a parser writes when it has no count to report, and a
 * health note built from a missing count reads as a zero-item day: these
 * assertions keep the defaults honest.
 */
const item: PickedItem = {
  key: 'src:1',
  title: 'T',
  link: 'https://example.invalid/a',
  publishedAt: null,
  summary: null,
  image: null,
  author: null,
  body: '',
};

describe('the result constructors', () => {
  it('defaults a success: matchCount is the item count, skipped 0, notes empty', () => {
    expect(succeed({ items: [item], kind: 'rss', sniffed: 'rss', marker: '<?xml' })).toEqual({
      ok: true,
      items: [item],
      kind: 'rss',
      sniffed: 'rss',
      marker: '<?xml',
      matchCount: 1,
      skipped: 0,
      notes: [],
    });
  });

  it('defaults a failure: the optional fields become explicit nulls, and the item count is 0', () => {
    expect(failWith({ reason: 'empty', kind: 'rss', detail: 'no bytes' })).toEqual({
      ok: false,
      reason: 'empty',
      detail: 'no bytes',
      kind: 'rss',
      sniffed: null,
      marker: null,
      cause: null,
      matchCount: null,
      itemCount: 0,
      notes: [],
    });
  });

  it('caps the skip notes at the caller’s number, and says nothing about none', () => {
    expect(
      skipNotes(
        [
          { index: 0, why: 'no title' },
          { index: 1, why: 'no link' },
        ],
        1,
      ),
    ).toEqual(['item 1: no title', '1 more item(s) skipped']);
    expect(skipNotes([])).toEqual([]);
  });
});

describe('the lead-in of a payload', () => {
  it('reports a comment that never closes, so the offsets it hands the scan are honest', () => {
    expect(leadIn('<!-- a proxy note that goes on')).toEqual({
      from: 0,
      bom: false,
      comment: true,
      blank: false,
      unterminated: true,
    });
  });

  it('says a payload of whitespace is blank, and a byte-order mark is a lead-in', () => {
    expect(leadIn('   \t\r\n ')).toEqual({ from: 7, bom: false, comment: false, blank: true, unterminated: false });
    expect(leadIn('﻿<rss>')).toEqual({ from: 1, bom: true, comment: false, blank: false, unterminated: false });
  });
});
