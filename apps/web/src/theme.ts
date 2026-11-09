import { useCallback, useState } from 'react';

/**
 * The theme, in three pieces that must agree: `data-theme` on `<html>`,
 * `localStorage`, and the inline script in `index.html` that applies the saved
 * choice **before first paint**.
 *
 * The key is written by hand in that script because the script cannot import a
 * module — it runs before the bundle exists. `THEME_KEY` is the one place the
 * name is spelled for the rest of the app, and the design contract (D-002) is
 * that the paper has no server-side rendering to coordinate with.
 */
export const THEME_KEY = 'newspa.theme';

export type Theme = 'light' | 'dark';

const element = (): HTMLElement | undefined => globalThis.document?.documentElement;

/** What the pre-paint script already decided. No flash, no double render. */
export const readTheme = (): Theme => (element()?.dataset['theme'] === 'dark' ? 'dark' : 'light');

export const writeTheme = (theme: Theme): void => {
  const at = element();
  if (at !== undefined) at.dataset['theme'] = theme;
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // A blocked storage (private mode) costs a remembered theme, nothing else.
  }
};

export const useTheme = (): { theme: Theme; toggle: () => void } => {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    writeTheme(next);
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
};
