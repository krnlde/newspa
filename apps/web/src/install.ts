import type { InstallMode } from 'newspa-paper';
import { useCallback, useEffect, useState } from 'react';

/**
 * The install control's state (WP16, D-039).
 *
 * The rule the component files enforce is that the dateline strip prints **one**
 * kind of entry, and this file decides which of three it is — a control that asks
 * the browser to install, a line naming the recipe for the browser that cannot,
 * or silence.
 *
 * `beforeinstallprompt` is Chromium's, and it is **one-shot**: the browser fires
 * it once, a listener that lets it go has nothing left, and after `prompt()` the
 * event is spent. So the event is captured, the control prints only while it is
 * in hand, and it retires on the press — a control whose act is "nothing happens"
 * is a lie, which is the standard this strip already holds its two switches to.
 *
 * iOS Safari has no install event, and D-039 names it: a control that is silently
 * absent is a feature the reader cannot find, so there the line prints iOS's own
 * recipe. A browser with **neither** — a desktop Firefox before it grew a prompt —
 * gets silence, because inventing a recipe for a menu this code has not measured
 * is the invention rule 5 forbids.
 */

/** The part of Chromium's `BeforeInstallPromptEvent` this app uses. */
interface PromptEvent extends Event {
  prompt(): Promise<void>;
}

/** The app running as an installed app: asking is pointless, so nothing prints. */
const isStandalone = (): boolean =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches === true ||
  (globalThis.navigator as { readonly standalone?: boolean }).standalone === true;

/** iOS Safari, including an iPad that asks for the desktop site (D-039's named case). */
const isIos = (): boolean =>
  /iPhone|iPad|iPod/.test(globalThis.navigator.userAgent) ||
  (globalThis.navigator.platform === 'MacIntel' && globalThis.navigator.maxTouchPoints > 1);

const initialMode = (): InstallMode => (isStandalone() ? 'none' : isIos() ? 'recipe' : 'none');

export interface InstallState {
  readonly mode: InstallMode;
  /** Ask the browser. A no-op when there is nothing to ask, so the control is never printed then. */
  readonly ask: () => void;
}

export const useInstallPrompt = (): InstallState => {
  const [event, setEvent] = useState<PromptEvent | null>(null);
  const [mode, setMode] = useState<InstallMode>(initialMode);

  useEffect(() => {
    if (isStandalone()) return;
    const capture = (raw: Event): void => {
      // Kept, not consumed: the browser fires this once, and the control is only
      // honest while the event is in hand.
      raw.preventDefault();
      setEvent(raw as unknown as PromptEvent);
      setMode('prompt');
    };
    // Installed by the browser's own menu while the page was open: the entry goes.
    const installed = (): void => setMode('none');
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const ask = useCallback((): void => {
    if (event === null) return;
    // Retire the control before the answer: the event is spent, and the outcome is
    // the reader's, not the page's to report.
    setEvent(null);
    setMode('none');
    void event.prompt().catch((cause: unknown) => {
      // Spoken in the console, not on the paper: a refused prompt leaves the edition
      // unchanged, and a sentence on the sheet about the browser's menu is not news.
      console.warn(`the install prompt failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }, [event]);

  return { mode, ask };
};
