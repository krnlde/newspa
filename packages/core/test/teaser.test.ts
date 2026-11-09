import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_CHARS,
  capBody,
  firstParagraph,
  isBoilerplateTeaser,
  TEASER_MAX_CHARS,
  teaserFor,
  truncate,
} from '../src/teaser.ts';

describe('truncate', () => {
  it('normalizes whitespace and leaves short text alone', () => {
    expect(truncate('  a  b ', 100)).toBe('a b');
    expect(truncate('', 10)).toBe('');
  });

  it('cuts at a sentence when the stop mark is past half the budget', () => {
    expect(truncate('Alpha beta gamma. Delta epsilon zeta eta theta iota kappa.', 25)).toBe('Alpha beta gamma.');
  });

  it('cuts at a word boundary when there is no stop mark, and marks the cut', () => {
    expect(truncate('alpha beta gamma delta epsilon zeta eta theta', 20)).toBe('alpha beta gamma…');
    expect(truncate('a b c', 3)).toBe('a b…');
  });

  it('ignores a stop mark or a space in the first half of the budget', () => {
    expect(truncate('First one is short. Second sentence runs on and on and on for a long time.', 40)).toBe(
      'First one is short. Second sentence runs…',
    );
    expect(truncate(`ab ${'x'.repeat(100)}`, 20)).toBe('ab xxxxxxxxxxxxxxxxx…');
    expect(truncate('abcdef', 3)).toBe('abc…');
  });

  it('never cuts mid-word when there is a space to use', () => {
    const cut = truncate('No stop marks at all in this long teaser text about the budget vote', 20);
    expect(cut).toBe('No stop marks at all…');
    expect(cut).not.toContain('  ');
  });
});

describe('capBody', () => {
  it('stores enough to notice a rewrite, and never an article', () => {
    expect(BODY_MAX_CHARS).toBe(1200);
    expect(capBody('a'.repeat(5000))).toHaveLength(BODY_MAX_CHARS + 1);
    expect(capBody('a'.repeat(5000)).endsWith('a…')).toBe(true);
    expect(capBody('Ten words only here.')).toBe('Ten words only here.');
  });
});

describe('firstParagraph', () => {
  it('splits on blank lines, not on a single newline', () => {
    expect(
      firstParagraph('First para text that is definitely long enough here.\n\nSecond one is long enough as well.'),
    ).toBe('First para text that is definitely long enough here.');
    expect(
      firstParagraph('First para text that is definitely long enough here.\r\n\r\nSecond one is long enough.'),
    ).toBe('First para text that is definitely long enough here.');
    expect(firstParagraph('Line one of a paragraph.\nSecond line of the same paragraph.')).toBe(
      'Line one of a paragraph. Second line of the same paragraph.',
    );
  });

  it('skips a deck that is too short to be a paragraph', () => {
    expect(firstParagraph('Short.\n\nA longer paragraph that is definitely more than forty characters long.')).toBe(
      'A longer paragraph that is definitely more than forty characters long.',
    );
    expect(firstParagraph('a'.repeat(39))).toBe('a'.repeat(39));
  });

  it('returns an empty string when there is no text at all', () => {
    expect(firstParagraph('')).toBe('');
    expect(firstParagraph('\n\n')).toBe('');
    expect(firstParagraph('   \n\n   ')).toBe('');
  });
});

describe('teaserFor', () => {
  it('prefers the deck the publisher wrote', () => {
    expect(
      teaserFor({ summary: 'Publisher deck.', body: 'Body paragraph that is long enough to be a teaser here.' }),
    ).toBe('Publisher deck.');
  });

  it('falls back to the first body paragraph when the summary is null, empty or whitespace', () => {
    const body = 'Body paragraph that is long enough to be a teaser if it has to be chosen.';
    expect(teaserFor({ summary: null, body })).toBe(body);
    expect(teaserFor({ summary: '', body })).toBe(body);
    expect(teaserFor({ summary: '   ', body })).toBe(body);
  });

  it('is an empty string when there is nothing to show: headline only is legitimate', () => {
    expect(teaserFor({ summary: null, body: '' })).toBe('');
  });

  it('caps at the teaser budget, and takes a per-source budget', () => {
    expect(TEASER_MAX_CHARS).toBe(240);
    expect(teaserFor({ summary: 'x'.repeat(400), body: '' })).toHaveLength(TEASER_MAX_CHARS + 1);
    expect(teaserFor({ summary: 'x'.repeat(400), body: '' }, 20)).toBe(`${'x'.repeat(20)}…`);
    expect(teaserFor({ summary: '  a   b  ', body: '' })).toBe('a b');
  });
});

describe('isBoilerplateTeaser', () => {
  it('drops continue-reading and sign-in prompts', () => {
    for (const value of [
      'Read the full story on the site today',
      'View the article in full on the publisher site',
      'Open the full story on the publisher site',
      'Click here to see more details now',
      'Tap here for the live blog coverage today',
      'Sign in to continue reading this piece',
      'Log in to read this article today',
      'Subscribe to continue reading this piece',
      // The BBC phrasing, which the first pattern missed: `continue reading`.
      'Continue reading the story and the rest of the coverage here',
      'Keep reading for the full account of the session',
    ]) {
      expect(isBoilerplateTeaser(value), value).toBe(true);
    }
  });

  it('drops anything too short to be a teaser', () => {
    expect(isBoilerplateTeaser('Breaking news')).toBe(true);
    expect(isBoilerplateTeaser('   ')).toBe(true);
  });

  it('keeps a real deck', () => {
    expect(isBoilerplateTeaser('The city council passed the budget after a long debate.')).toBe(false);
  });
});
