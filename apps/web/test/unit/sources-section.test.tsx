import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/i18n/index.ts';
import { de } from '../../src/i18n/locales/de.ts';
import { en } from '../../src/i18n/locales/en.ts';
import {
  answer,
  LIST,
  one,
  readingListRefused,
  STATUS,
  sourcesHarness,
  stubRead,
  stubSourcesWire,
  textOf,
} from './support/sourcesWire.tsx';

/**
 * The sources **shell**, reading (WP14): the query and the states around it.
 * `packages/paper/test/sources-*.test.tsx` owns the markup's contract; what is
 * under test here is the wiring the panel cannot do for itself:
 *
 *  - the list arrives from `/api/sources`, and every state around it is stated —
 *    a read in flight prints a line, a read that failed prints **what the server
 *    said**, so the panel is never a silent zero (rule 5);
 *  - the reading-list rule (rule 18, D-034): from a peer that is not loopback the
 *    read itself is refused, and the page prints the server's own sentence;
 *  - the chrome is the reader's language (D-019), because the labels are built
 *    from `useTranslation`'s `t` at render time, not at module load.
 *
 * The two mutations are in `sources-write.test.tsx`; the shared wire and mount
 * are in `support/sourcesWire.tsx`.
 */

const harness = sourcesHarness();
const { mount, mounted, dispose } = harness;

beforeEach(async () => {
  await initI18n({ language: 'en' });
});

afterEach(dispose);

describe('the list', () => {
  it('prints the files the server listed, in the panel, beside the paper', async () => {
    stubSourcesWire(() => answer(LIST));
    const { root } = await mounted();
    expect(root.querySelectorAll("[data-part='source-row']")).toHaveLength(2);
    expect(textOf("[data-part='sources-dir']")).toBe('Files in /home/reader/newspa/sources');
    expect(textOf("[data-part='source-row'][data-file='bbc-world.json'] [data-part='source-state']")).toBe(
      en.paper.health.state.ok,
    );
  });

  it('prints the loader’s lines for the file that does not parse', async () => {
    stubSourcesWire(() => answer(LIST));
    await mounted();
    expect(textOf("[data-part='source-row'][data-file='broken.json'] [data-part='issues']")).toContain(
      'the file is not valid JSON',
    );
  });

  it('prints a loading line while the read is in the air, never a blank panel', () => {
    stubRead(() => new Promise<Response>(() => undefined));
    mount();
    expect(textOf(STATUS)).toBe(en.sources.loading);
  });

  it('states what the server said when the list did not load', async () => {
    stubRead(() => answer({ error: 'no source directory: sources/ is missing' }, 503));
    mount();
    await screen.findByText(new RegExp(en.sources.failed));
    expect(textOf(STATUS)).toContain('sources/ is missing');
    // The modal is the box. A `panel` class here is a ringed, dotted box inside
    // the dialog's box — measured in Edge, and it read as a frame within a frame.
    expect(one("[data-part='sources']").className).not.toContain('panel');
  });

  it('states a transport failure that is not an Error, in the region that reports it', async () => {
    stubRead(async (): Promise<Response> => {
      throw 'socket hang up';
    });
    mount();
    await screen.findByText(new RegExp(en.sources.failed));
    expect(textOf(STATUS)).toContain('socket hang up');
  });

  it('speaks the reader’s language, because the labels are built at render time', async () => {
    await initI18n({ language: 'de' });
    stubSourcesWire(() => answer(LIST));
    await mounted();
    expect(textOf("[data-part='sources-dir']")).toBe('Dateien in /home/reader/newspa/sources');
    expect(one("[data-part='source-delete']").textContent).toBe(de.sources.remove);
  });
});

describe('a peer the reading-list rule refuses (rule 18, D-034)', () => {
  it('states the server’s own sentence for a 403 on the list, and offers no affordance', async () => {
    // What a phone gets: `/api/sources` is loopback-only for **every verb**, so the
    // read itself is refused, and the refusal is the sentence `net.ts` writes —
    // including that the paper stays readable. Printing it is the point: a blank
    // panel would read as "no sources", which is rule 5's silent zero.
    stubRead(readingListRefused);
    mount();
    await screen.findByText(new RegExp(en.sources.failed));
    expect(textOf(STATUS)).toContain('loopback-only');
    expect(textOf(STATUS)).toContain('the paper itself is readable');
    expect(document.querySelectorAll("[data-part='source-save'], [data-part='source-edit']")).toHaveLength(0);
  });

  it('shows the read-only sentence, and no affordance the server would refuse', async () => {
    // The panel's own half of the rule: a list that reports `writable: false`
    // renders the sentence and **no** buttons, so the page cannot offer a write the
    // server refuses before routing.
    stubSourcesWire(undefined, () => answer({ ...LIST, writable: false }));
    await mounted();
    expect(textOf("[data-part='sources-readonly']")).toBe(en.sources.readOnly);
    expect(document.querySelectorAll("[data-part='source-save'], [data-part='source-edit']")).toHaveLength(0);
  });
});
