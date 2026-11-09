import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTheme, THEME_KEY, useTheme, writeTheme } from '../../src/theme.ts';

/**
 * The theme has to agree in three places — `data-theme` on `<html>`,
 * `localStorage`, and the React state — and the paper's contract is that the
 * inline script in `index.html` decides **before first paint**. So the tests
 * that matter are: `readTheme` reads the document (no flash), `writeTheme`
 * writes both stores, and a blocked `localStorage` (private mode) costs the
 * remembered theme and nothing else — the page must still switch.
 */

const html = (): HTMLElement => {
  const at = globalThis.document?.documentElement;
  if (at === undefined) throw new Error('happy-dom gave no document');
  return at;
};

const withDataTheme = (theme: string | null): void => {
  const at = html();
  // `DOMStringMap` is an index signature, so the property is read with brackets
  // (`noPropertyAccessFromIndexSignature`).
  if (theme === null) delete at.dataset['theme'];
  else at.dataset['theme'] = theme;
};

const dataTheme = (): string | null => html().getAttribute('data-theme');

/** A `localStorage` that throws on write, i.e. private mode. */
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

/** `test/setup.ts` clears storage, not the document: the theme lives in
 * `data-theme`, so a test that reads the theme has to start from a clean one. */
beforeEach(() => withDataTheme(null));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readTheme', () => {
  it('is what the pre-paint script already decided', () => {
    withDataTheme('dark');
    expect(readTheme()).toBe('dark');
    withDataTheme('light');
    expect(readTheme()).toBe('light');
  });

  it('is light when the script found nothing to apply', () => {
    expect(readTheme()).toBe('light');
  });

  it('is light for a value that is not a theme, so a typo cannot unstyle the paper', () => {
    withDataTheme('sepia');
    expect(readTheme()).toBe('light');
  });
});

describe('writeTheme', () => {
  it('names the key the inline `index.html` script spells by hand', () => {
    expect(THEME_KEY).toBe('newspa.theme');
  });

  it('sets `data-theme` and storage together, in both directions', () => {
    writeTheme('dark');
    expect(dataTheme()).toBe('dark');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBe('dark');
    writeTheme('light');
    expect(dataTheme()).toBe('light');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBe('light');
  });

  it('writes storage when there is no document to write to', () => {
    // The paper has no server-side rendering to coordinate with (D-002), and the
    // inline script only ever *reads* `data-theme`. Without an element to set,
    // the choice must still reach storage, because that is what the next
    // page-load's script reads.
    vi.stubGlobal('document', undefined);
    writeTheme('dark');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('keeps switching when storage is blocked, and remembers nothing', () => {
    // Private mode: Safari throws on `setItem`. The page still has to switch.
    // The global is replaced, not spied: happy-dom's `Storage` hands out *bound*
    // methods from a Proxy, so a `Storage.prototype` spy is bypassed and the
    // write lands (measured, 2026-11-09).
    vi.stubGlobal('localStorage', blockedStorage());
    expect(() => writeTheme('dark')).not.toThrow();
    expect(dataTheme()).toBe('dark');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBeNull();
    expect(() => writeTheme('light')).not.toThrow();
    expect(dataTheme()).toBe('light');
    vi.unstubAllGlobals();
  });
});

describe('useTheme', () => {
  it('starts from the document, not from a default', () => {
    withDataTheme('dark');
    expect(renderHook(useTheme).result.current.theme).toBe('dark');
    withDataTheme('light');
    expect(renderHook(useTheme).result.current.theme).toBe('light');
    withDataTheme(null);
    expect(renderHook(useTheme).result.current.theme).toBe('light');
  });

  it('moves all three places on one toggle', () => {
    const { result } = renderHook(useTheme);
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(dataTheme()).toBe('dark');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBe('dark');
  });

  it('returns to light on the second toggle, from a dark start too', () => {
    withDataTheme('dark');
    const { result } = renderHook(useTheme);
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(dataTheme()).toBe('light');
    expect(globalThis.localStorage?.getItem(THEME_KEY)).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('is a new read of the document on every mount', () => {
    writeTheme('dark');
    expect(renderHook(useTheme).result.current.theme).toBe('dark');
    writeTheme('light');
    expect(renderHook(useTheme).result.current.theme).toBe('light');
  });

  it('hands out a toggle whose value follows the state, not the first render', () => {
    const { result, rerender } = renderHook(useTheme);
    act(() => result.current.toggle());
    rerender();
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(dataTheme()).toBe('light');
  });
});
