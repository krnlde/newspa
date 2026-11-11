import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n/index.ts';
import {
  answer,
  edited,
  editOf,
  LIST,
  one,
  ROW,
  refusal,
  STATUS,
  saveOf,
  sourcesHarness,
  stubSourcesWire,
  textOf,
  theBodyOf,
  urlOf,
} from './support/sourcesWire.tsx';

/**
 * The sources **shell**, writing (WP14): the two mutations a reader makes from the
 * panel, and what the answer leaves on the page.
 *
 *  - a write posts the **bytes the reader edited** with the file they came from,
 *    and invalidates `['sources']` **and** `['state']`: the file is the reading
 *    list, and a successful write upserts the row server-side (`sourcesApi.ts`),
 *    so the paper's own news changes with it;
 *  - a skeleton posts **no filename**, so the server names the file from the id —
 *    D-011's rule, checked server-side, not enforced by the form;
 *  - a refusal is rendered in the loader's own words, and a guard's 403 in the
 *    address policy's words: the panel never paraphrases a refusal (rule 5, and
 *    the reader's fix-list is the loader's sentence, not a translation of it);
 *  - a removal asks once, in the page, and then sends `DELETE ?id=`.
 */

const { mount, mounted, dispose } = sourcesHarness();

/** Click the row's delete, then the page's own confirmation. */
const removeWithConfirm = (): void => {
  fireEvent.click(one("[data-part='source-delete']"));
  fireEvent.click(one("[data-part='confirm-yes']"));
};

beforeEach(async () => {
  await initI18n({ language: 'en' });
});

afterEach(dispose);

describe('a write from the panel', () => {
  it('posts the bytes the reader edited, with the file they came from', async () => {
    const mock = stubSourcesWire(() => answer({ ok: true, file: '/sources/bbc-world.json', messages: ['wrote it'] }));
    await mounted();
    fireEvent.click(editOf());
    saveOf(edited);
    await screen.findByText('wrote it');
    expect(theBodyOf(mock, 'POST')).toStrictEqual({ text: edited, filename: 'bbc-world.json' });
  });

  it('invalidates the list and the paper, because the row is upserted by the write', async () => {
    stubSourcesWire(() => answer({ ok: true, file: '/sources/bbc-world.json', messages: ['wrote it'] }));
    const { cache } = await mounted();
    const invalidated = vi.spyOn(cache, 'invalidateQueries');
    fireEvent.click(editOf());
    saveOf(edited);
    await screen.findByText('wrote it');
    const keys = invalidated.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([['sources'], ['state']]));
  });

  it('prints the loader’s refusal lines, in the row and in the status region', async () => {
    // Two places, on purpose: the row is where the bytes are, so the reason sits
    // beside them; the region is the record of the last answer the server gave.
    stubSourcesWire(() => refusal(['id: the filename is the id (D-011)', 'url: Expected a valid URL']));
    await mounted();
    fireEvent.click(editOf());
    saveOf('{ "id": "other" }');
    await screen.findByText(/the filename is the id/u, { selector: "[data-part='source-error']" });
    expect(textOf(STATUS)).toContain('id: the filename is the id (D-011)');
    expect(textOf(STATUS)).toContain('url: Expected a valid URL');
  });

  it('prints the guard’s sentence when the peer is not loopback', async () => {
    stubSourcesWire(() => answer({ error: 'POST from 10.0.0.5 is refused: writes are loopback-only (D-034)' }, 403));
    await mounted();
    fireEvent.click(editOf());
    saveOf(edited);
    await screen.findByText(/loopback-only/u, { selector: "[data-part='source-error']" });
    expect(textOf(STATUS)).toContain('(D-034)');
  });

  it('inserts a skeleton and posts it with no filename', async () => {
    const mock = stubSourcesWire(() => answer({ ok: true, file: '/sources/new-source.json', messages: ['wrote it'] }));
    await mounted();
    fireEvent.change(one<HTMLSelectElement>("[data-part='template-menu']"), { target: { value: 'rss' } });
    fireEvent.click(one("[data-part='new-save']"));
    await screen.findByText('wrote it');
    const posted = theBodyOf(mock, 'POST');
    expect(posted['filename']).toBeUndefined();
    expect(String(posted['text'])).toContain('"id": "new-source"');
  });

  it('keeps the reader’s text on the page when the server refuses it', async () => {
    // A refused write that clears the box loses the work. `api.ts` returns the
    // refusal and the shell rejects the mutation with it (`RefusalError`), so the
    // editor keeps the bytes and states the reason beside them.
    stubSourcesWire(() => refusal(['url: Expected a valid URL']));
    const { root } = await mounted();
    fireEvent.click(editOf());
    saveOf('{ "id": "other" }');
    await screen.findByText(/Expected a valid URL/u, { selector: "[data-part='source-error']" });
    expect(one<HTMLTextAreaElement>(`${ROW} [data-part='source-text']`).value).toBe('{ "id": "other" }');
    expect(root.querySelectorAll("[data-part='sources-status']")).toHaveLength(1);
  });
});

describe('a delete from the panel', () => {
  it('asks once in the page, then sends DELETE with the id', async () => {
    const mock = stubSourcesWire(() => answer({ ok: true, file: '/sources/bbc-world.json', messages: ['removed'] }));
    await mounted();
    fireEvent.click(one("[data-part='source-delete']"));
    expect(mock.mock.calls.filter((call) => call[1]?.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(one("[data-part='confirm-yes']"));
    await screen.findByText('removed');
    expect(urlOf(mock, 'DELETE')).toBe('/api/sources?id=bbc-world');
  });

  it('states the reason the server gave for the row it could not remove', async () => {
    stubSourcesWire(() =>
      answer({ ok: false, file: null, messages: ['no source file named bbc-world.json in /sources'] }, 404),
    );
    await mounted();
    removeWithConfirm();
    await screen.findByText(/no source file named/u, { selector: "[data-part='source-error']" });
    expect(textOf(STATUS)).toContain('no source file named bbc-world.json');
  });

  it('invalidates both queries after a removal, because the row is disabled server-side', async () => {
    stubSourcesWire(() => answer({ ok: true, file: '/sources/bbc-world.json', messages: ['removed'] }));
    const { cache } = await mounted();
    const invalidated = vi.spyOn(cache, 'invalidateQueries');
    removeWithConfirm();
    await screen.findByText('removed');
    const keys = invalidated.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([['sources'], ['state']]));
  });

  it('lists no file at all, in words, when the directory is empty (rule 5)', async () => {
    stubSourcesWire(undefined, () => answer({ ...LIST, files: [] }));
    const { root } = mount();
    await screen.findByText(/No source files/u);
    expect(root.querySelectorAll("[data-part='source-row']")).toHaveLength(0);
    expect(textOf("[data-part='sources-empty']")).toContain('pnpm sources:init');
  });
});
