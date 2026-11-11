import { describe, expect, it } from 'vitest';
import { derivePick } from '../src/pick/derivePick.ts';
import type { PathStep, PickFingerprint, PickOutcome } from '../src/pick/types.ts';
import { fixture } from './support.ts';

/**
 * The pick derivation (WP6, D-036): a click's fingerprint and the **raw bytes** in,
 * a selector and a verdict out. No browser, no fetch — the whole point of D-036's
 * split is that the derivation runs in Node, in the parser's own DOM, so these are
 * ordinary unit tests over fixture payloads.
 *
 * Four claims, and each is a shape the reader can land on:
 *
 *  - the **general case**: a card list with a class hook, where the bare tag
 *    over-matches, must derive the hook and the measured `matchCount`;
 *  - the **positional case**: a set no CSS shape describes exactly must derive a
 *    `:nth-child` selector list **and say the word**, because a positional
 *    selector is a claim about this page's order;
 *  - the **rendered page**: a path that does not walk into the bytes is refused by
 *    name, with the render answer attached — writing the browser's selector would
 *    be a poll that reports a quiet zero (rule 5, D-007);
 *  - **fields are only written when they read on every item**, and a field that is
 *    not written is named, with the ratio.
 */

const click = (path: readonly (readonly [string, number])[], over: Partial<PickFingerprint> = {}): PickFingerprint => ({
  url: 'https://example.invalid/world',
  path: path.map(([tag, index]): PathStep => ({ tag, index })),
  href: null,
  outerHtml: '<li class="card"><h2 class="title"><a href="/a2">Second story</a></h2></li>',
  text: 'Second story',
  siblings: 4,
  ...over,
});

const requireOk = (outcome: PickOutcome): Extract<PickOutcome, { ok: true }> => {
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.detail}`);
  return outcome;
};

const requireFail = (outcome: PickOutcome): Extract<PickOutcome, { ok: false }> => {
  if (outcome.ok) throw new Error(`expected a refusal, got list '${outcome.list}'`);
  return outcome;
};

describe('a card list with a class hook', () => {
  const html = fixture('pick-card-list.html');
  const outcome = requireOk(
    derivePick(
      click(
        [
          ['html', 1],
          ['body', 2],
          ['main', 2],
          ['ul', 2],
          ['li', 2],
        ],
        { href: 'https://example.invalid/a2' },
      ),
      html,
    ),
  );

  it('derives the hook, not the bare tag: the nav and footer li are not the list', () => {
    expect(outcome.list).toBe('.card');
    expect(outcome.positional).toBe(false);
    expect(outcome.matchCount).toBe(4);
    expect(outcome.notes.filter((line) => line.includes('positional'))).toEqual([]);
  });

  it('writes fields that read a story out of every item', () => {
    expect(outcome.fields).toEqual({ title: 'a', link: 'a', summary: '[class*=deck]' });
  });

  it('prints the sample from the item that was clicked', () => {
    expect(outcome.sample).toEqual({
      title: 'Second story',
      link: '/a2',
      summary: 'One paragraph about the second story, as the publisher writes it.',
    });
  });

  it('states which DOM the selector was derived from', () => {
    const line = outcome.notes.find((note) => note.includes('bytes the poller fetches'));
    expect(line).toBeDefined();
    expect(line ?? '').toContain('ul:nth-child(2)');
  });

  it('names the divergence when the browser and the bytes disagree about the count', () => {
    const split = requireOk(
      derivePick(
        click(
          [
            ['html', 1],
            ['body', 2],
            ['main', 2],
            ['ul', 2],
            ['li', 2],
          ],
          { siblings: 11 },
        ),
        html,
      ),
    );
    const note = split.notes.find((line) => line.includes('the browser showed'));
    expect(note).toBeDefined();
    expect(note ?? '').toContain('showed 11 items');
    expect(note ?? '').toContain('match 4');
  });
});

describe('a list where the anchor is the card', () => {
  const outcome = requireOk(
    derivePick(
      click(
        [
          ['html', 1],
          ['body', 2],
          ['div', 1],
          ['ul', 1],
          ['li', 3],
        ],
        { href: 'https://example.invalid/s3', siblings: 5, text: 'Story three, in the lite list' },
      ),
      fixture('pick-anchor-list.html'),
    ),
  );

  it('takes the bare tag, and measures five items', () => {
    expect(outcome.list).toBe('li');
    expect(outcome.positional).toBe(false);
    expect(outcome.matchCount).toBe(5);
  });

  it('writes title and link, and no summary the items cannot fill', () => {
    expect(outcome.fields).toEqual({ title: 'a', link: 'a' });
    const note = outcome.notes.find((line) => line.includes('fields.summary is not set'));
    expect(note).toBeDefined();
    expect(note ?? '').toContain('0 of 5');
  });

  it('reads the sample at the clicked index, not the first item', () => {
    expect(outcome.sample.title).toBe('Story three, in the lite list');
    expect(outcome.sample.link).toBe('/s3');
  });
});

describe('siblings of mixed shape: the positional ladder', () => {
  const outcome = requireOk(
    derivePick(
      click(
        [
          ['html', 1],
          ['body', 2],
          ['section', 1],
          ['article', 1],
        ],
        { siblings: 4, text: 'Story one in the section' },
      ),
      fixture('pick-mixed-siblings.html'),
    ),
  );

  it('falls to a :nth-child selector list, because no CSS shape describes that set', () => {
    expect(outcome.positional).toBe(true);
    expect(outcome.matchCount).toBe(4);
    expect(outcome.list).toContain('article:nth-child(1)');
    expect(outcome.list).toContain('h2:nth-child(4)');
  });

  it('says the word "positional", and what it costs', () => {
    const note = outcome.notes.find((line) => line.includes('positional'));
    expect(note).toBeDefined();
    expect(note ?? '').toContain('matchCount');
  });

  it('keeps the fields that read everywhere, and names the one it dropped', () => {
    expect(outcome.fields).toEqual({ title: 'a', link: 'a' });
    expect(outcome.notes.some((line) => line.includes('3 of 4'))).toBe(true);
  });
});

describe('the page a script builds', () => {
  const failed = requireFail(
    derivePick(
      click(
        [
          ['html', 1],
          ['body', 2],
          ['div', 1],
          ['ul', 1],
          ['li', 2],
        ],
        { siblings: 3 },
      ),
      fixture('pick-script-shell.html'),
    ),
  );

  it('refuses by name, and says what it found', () => {
    expect(failed.reason).toBe('path-unmapped');
    expect(failed.detail).toContain('ul');
    expect(failed.detail).toContain('0 element children');
  });

  it('names the render answer, and writes nothing', () => {
    expect(failed.notes.join(' ')).toContain('render: true');
    expect('list' in failed).toBe(false);
  });

  it('refuses when the path walks to a different tag', () => {
    const mismatch = requireFail(
      derivePick(
        click(
          [
            ['html', 1],
            ['body', 2],
            ['footer', 2],
          ],
          { siblings: 2 },
        ),
        fixture('pick-card-list.html'),
      ),
    );
    expect(mismatch.reason).toBe('path-unmapped');
    expect(mismatch.detail).toContain('<main>');
  });
});

describe('a click that is not a list', () => {
  it('refuses a lone node, and points at a page source (D-028)', () => {
    const failed = requireFail(
      derivePick(
        click(
          [
            ['html', 1],
            ['body', 2],
            ['div', 1],
          ],
          { siblings: 1, text: 'Example Lite' },
        ),
        fixture('pick-anchor-list.html'),
      ),
    );
    expect(failed.reason).toBe('not-a-list');
    expect(failed.notes.join(' ')).toContain('no list');
  });

  it('refuses items with no link, and names the ratio (rule 5)', () => {
    const failed = requireFail(
      derivePick(
        click(
          [
            ['html', 1],
            ['body', 2],
            ['main', 2],
            ['h1', 1],
          ],
          { siblings: 2, text: 'World' },
        ),
        fixture('pick-card-list.html'),
      ),
    );
    expect(failed.reason).toBe('no-anchor');
    expect(failed.detail).toContain('1 of 2');
  });
});
