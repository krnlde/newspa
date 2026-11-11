import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRAST_KEY, initialContrast, readContrast, useContrast, writeContrast } from '../../src/contrast.ts';

/**
 * The contrast axis (D-038), in the same three places as the theme (D-002):
 * `data-contrast` on `<html>`, `localStorage`, and the React state — plus a fourth
 * way in, the **url**, which is how a device on the wall is set without a keyboard.
 *
 * The claims that matter:
 *
 *  - the pre-paint script's decision is what the hook starts from, so there is no
 *    flash and no second render;
 *  - **the url outranks storage, and writes nothing.** A wall link
 *    (`?contrast=more`) is the whole configuration; a phone that opens it once must
 *    not lose the choice it made for itself;
 *  - **silence is not `normal`.** With no attribute set, the system's
 *    `prefers-contrast: more` still applies (the CSS gates that block on
 *    `:root:not([data-contrast])`), so the page writes the attribute only on a press;
 *  - a blocked `localStorage` costs the memory and nothing else.
 */

const html = (): HTMLElement => {
  const at = globalThis.document?.documentElement;
  if (at === undefined) throw new Error('happy-dom gave no document');
  return at;
};

const withDataContrast = (value: string | null): void => {
  const at = html();
  if (value === null) delete at.dataset['contrast'];
  else at.dataset['contrast'] = value;
};

const dataContrast = (): string | null => html().getAttribute('data-contrast');

const atSearch = (search: string): void => {
  vi.stubGlobal('location', { ...globalThis.location, search });
};

const blockedStorage = (): Storage => ({
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => {
    throw new Error('QuotaExceededError: storage is blocked');
  },
});

beforeEach(() => {
  withDataContrast(null);
  atSearch('');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readContrast', () => {
  it('is what the pre-paint script already decided', () => {
    withDataContrast('more');
    expect(readContrast()).toBe('more');
    withDataContrast('normal');
    expect(readContrast()).toBe('normal');
  });

  it('is `normal` when nothing was written — and that is the page having no opinion', () => {
    // The system's own `prefers-contrast: more` is still in force here: the CSS
    // block is gated on `:root:not([data-contrast])`.
    expect(readContrast()).toBe('normal');
    expect(dataContrast()).toBeNull();
  });

  it('is `normal` for a value that is not an axis setting, so a typo cannot unstyle the paper', () => {
    withDataContrast('max');
    expect(readContrast()).toBe('normal');
  });
});

describe('initialContrast (D-038)', () => {
  it('asks the url first: a wall device is set by a link, with no clicks', () => {
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'normal');
    atSearch('?theme=dark&contrast=more');
    expect(initialContrast()).toBe('more');
  });

  it('ignores a url value that is not the axis, and falls through to what is saved', () => {
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'more');
    atSearch('?contrast=1');
    expect(initialContrast()).toBe('more');
  });

  it('takes the saved choice when the url says nothing', () => {
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'more');
    expect(initialContrast()).toBe('more');
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'normal');
    expect(initialContrast()).toBe('normal');
  });

  it('reads the document when neither the url nor storage has an opinion', () => {
    withDataContrast('more');
    expect(initialContrast()).toBe('more');
  });

  it('survives a blocked storage by reading the document', () => {
    vi.stubGlobal('localStorage', blockedStorage());
    withDataContrast('more');
    expect(initialContrast()).toBe('more');
    vi.unstubAllGlobals();
  });
});

describe('writeContrast', () => {
  it('names the key the inline `index.html` script spells by hand', () => {
    expect(CONTRAST_KEY).toBe('newspa.contrast');
  });

  it('sets `data-contrast` and storage together, in both directions', () => {
    writeContrast('more');
    expect(dataContrast()).toBe('more');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBe('more');
    writeContrast('normal');
    expect(dataContrast()).toBe('normal');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBe('normal');
  });

  it('writes storage when there is no document to write to', () => {
    vi.stubGlobal('document', undefined);
    writeContrast('more');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBe('more');
    vi.unstubAllGlobals();
  });

  it('keeps switching when storage is blocked, and remembers nothing', () => {
    vi.stubGlobal('localStorage', blockedStorage());
    expect(() => writeContrast('more')).not.toThrow();
    expect(dataContrast()).toBe('more');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('useContrast', () => {
  it('starts from the url, then storage, then the document', () => {
    atSearch('?contrast=more');
    expect(renderHook(useContrast).result.current.contrast).toBe('more');
    atSearch('');
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'more');
    expect(renderHook(useContrast).result.current.contrast).toBe('more');
    globalThis.localStorage?.setItem(CONTRAST_KEY, 'normal');
    expect(renderHook(useContrast).result.current.contrast).toBe('normal');
  });

  it('moves all three places on one toggle, and writes the url’s value to no storage', () => {
    atSearch('?contrast=more');
    const { result } = renderHook(useContrast);
    expect(result.current.contrast).toBe('more');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBeNull();
    act(() => result.current.toggle());
    expect(result.current.contrast).toBe('normal');
    expect(dataContrast()).toBe('normal');
    expect(globalThis.localStorage?.getItem(CONTRAST_KEY)).toBe('normal');
  });

  it('cycles more → normal → more, and the paper’s CSS composes with the theme', () => {
    const { result } = renderHook(useContrast);
    act(() => result.current.toggle());
    expect(result.current.contrast).toBe('more');
    act(() => result.current.toggle());
    expect(result.current.contrast).toBe('normal');
    expect(dataContrast()).toBe('normal');
  });

  it('hands out a toggle whose value follows the state, not the first render', () => {
    const { result, rerender } = renderHook(useContrast);
    act(() => result.current.toggle());
    rerender();
    act(() => result.current.toggle());
    expect(result.current.contrast).toBe('normal');
    expect(dataContrast()).toBe('normal');
  });
});
