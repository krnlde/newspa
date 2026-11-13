import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { anEdition, anItem, at, one, PART, THE_LABELS, textsOf } from './support.ts';
import { editedItem, rowParts, showPaper } from './support-page.tsx';

/**
 * The edited strip: the stories whose text changed, each with the word diff of the
 * teaser as its evidence. It renders through `Paper` (`support-page.tsx`), because
 * the strip is a block of the page and owns no data of its own — `Paper` hands it
 * `edition.edited`, the labels and the formatters.
 *
 * The dates are the pair the page uses everywhere (docs/design.md): the **age** is
 * what prints, and the `title` carries the instant, zone named. This row's link is
 * inline, so the tooltip hangs on the date's own element — a story card cannot do
 * that, because its headline paints an overlay over the whole card (`Story.tsx`).
 */

afterEach(cleanup);

describe('the edited strip', () => {
  it('prints one row per story that has a report, with its headline, diff and stamp', () => {
    const { container } = showPaper({
      edition: anEdition({
        edited: [
          editedItem('world:2', { title: 'Rates held for the third month running' }),
          editedItem('tech:4', { sourceLabel: 'Example Tech', title: 'A standard body agrees on a wire format' }),
        ],
      }),
    });
    expect(one(`${PART.edited} ${PART.blockHead}`, container).textContent).toBe(THE_LABELS.editedHeadline);
    expect(container.querySelectorAll(PART.editedRow)).toHaveLength(2);
    expect(textsOf(`${PART.editedRow} ${PART.headline} a`, container)).toEqual([
      'Rates held for the third month running',
      'A standard body agrees on a wire format',
    ]);
    expect(textsOf(`${PART.editedRow} ${PART.source}`, container)).toEqual(['Example World', 'Example Tech']);
    expect(container.querySelectorAll(`${PART.editedRow} ${PART.diff}`)).toHaveLength(2);
    const rows = [...container.querySelectorAll<HTMLElement>(PART.editedRow)];
    const first = rows[0];
    if (first === undefined) throw new Error('the edited strip printed no row');
    expect(rowParts(first)).toEqual(['headline', 'diff', 'meta']);
    const link = one<HTMLAnchorElement>(`${PART.headline} a`, first);
    expect(link.getAttribute('href')).toBe('https://feeds.example.test/first-story');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toBe(THE_LABELS.opensInNewTab('Example World'));
    expect(one(PART.count, first).textContent).toBe('9 added, 5 removed');
    expect(textsOf(`${PART.editedRow} ${PART.meta}`, container)).toEqual([
      `ago(${at('09:30')})`,
      `ago(${at('09:30')})`,
    ]);
    // An age on the page, the instant in the tooltip. This row's link is inline, so
    // the date's own element carries the attribute — unlike a story card, whose
    // headline paints an overlay over the whole card (see `Story.tsx`).
    expect(
      [...container.querySelectorAll<HTMLElement>(`${PART.editedRow} ${PART.meta}`)].map((p) =>
        p.getAttribute('title'),
      ),
    ).toEqual([`stamp(${at('09:30')})`, `stamp(${at('09:30')})`]);
  });

  it('omits a story whose report is null, and prints no strip when none has one', () => {
    const { container } = showPaper({ edition: anEdition({ edited: [anItem({ key: 'world:9' })] }) });
    expect(container.querySelector(PART.edited)).toBeNull();
    expect(container.querySelectorAll(PART.editedRow)).toHaveLength(0);
  });

  it('falls back to the publication instant when a story was changed at no recorded one', () => {
    const { container } = showPaper({
      edition: anEdition({ edited: [editedItem('world:2', { lastChangedAt: null, publishedAt: at('06:00') })] }),
    });
    const meta = one(`${PART.editedRow} ${PART.meta}`, container);
    expect(meta.textContent).toBe(`ago(${at('06:00')})`);
    expect(meta.getAttribute('title')).toBe(`stamp(${at('06:00')})`);
  });

  it('prints no date and carries no tooltip when the publisher declared no instant', () => {
    const { container } = showPaper({
      edition: anEdition({ edited: [editedItem('world:2', { lastChangedAt: null, publishedAt: null })] }),
    });
    const meta = one(`${PART.editedRow} ${PART.meta}`, container);
    expect(meta.textContent).toBe('');
    expect(meta.hasAttribute('title')).toBe(false);
  });
});
