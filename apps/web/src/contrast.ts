import { useCallback, useState } from 'react';
import { readParam, readSaved, writeSaved } from './choice.ts';

/**
 * The contrast axis (D-038), in the same three pieces as the theme (D-002):
 * `data-contrast` on `<html>`, `localStorage`, and the pre-paint script in
 * `index.html`.
 *
 * It is an **axis, not a mode**: `data-theme` answers which stock, this answers how
 * hard, and the two compose — the e-ink wall wants black on white *and* white on
 * black, which is two knobs, not four themes. The CSS rebinds the same token names
 * under `[data-contrast='more']`, so no component knows the mode exists.
 */
export const CONTRAST_KEY = 'newspa.contrast';

/** The url's name for the axis: a wall device is set by a link (D-038). */
export const CONTRAST_PARAM = 'contrast';

export type Contrast = 'normal' | 'more';

const element = (): HTMLElement | undefined => globalThis.document?.documentElement;

/** What the pre-paint script already decided. No flash, no double render. */
export const readContrast = (): Contrast => (element()?.dataset['contrast'] === 'more' ? 'more' : 'normal');

const of = (value: string | null): Contrast | null => (value === 'more' || value === 'normal' ? value : null);

/**
 * The value the page starts with: the url's, then the saved one, then what the
 * pre-paint script wrote (which is the same two reads, done before the bundle
 * existed, so state and markup cannot disagree).
 *
 * `normal` is **the page's own opinion**, and it is not the same as silence: a
 * reader whose system asks for `prefers-contrast: more` gets the rules in ink from
 * `base.css`, whose block is gated on `:root:not([data-contrast])`. Writing
 * `normal` refuses that, which is why nothing is written until a press.
 */
export const initialContrast = (): Contrast =>
  of(readParam(CONTRAST_PARAM)) ?? of(readSaved(CONTRAST_KEY)) ?? readContrast();

export const writeContrast = (contrast: Contrast): void => {
  const at = element();
  if (at !== undefined) at.dataset['contrast'] = contrast;
  writeSaved(CONTRAST_KEY, contrast);
};

export const useContrast = (): { contrast: Contrast; toggle: () => void } => {
  const [contrast, setContrast] = useState<Contrast>(initialContrast);
  const toggle = useCallback(() => {
    const next: Contrast = contrast === 'more' ? 'normal' : 'more';
    writeContrast(next);
    setContrast(next);
  }, [contrast]);
  return { contrast, toggle };
};
