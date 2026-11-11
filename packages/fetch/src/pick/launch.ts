import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { INSPECTOR_SOURCE, PICK_BINDING } from './inspector.ts';

/**
 * The headed pick session (WP6, D-036): a real browser window, the reader's click,
 * a fingerprint back out.
 *
 * This is the only module in the package that opens a browser, and the only one
 * `vitest.coverage.json` excludes: the code path is a window, a cursor and a
 * human, and `test/browser/pickLoop.test.ts` drives it in real Edge instead of
 * pretending to. Everything it returns is a **named** fault, so a pick that
 * produced nothing says which of the five things happened (rule 5) — the failure
 * this whole project is built against is a tool that answers "no items" when the
 * truth is "no browser".
 *
 * Four decisions live here:
 *
 *  - `channel: 'msedge'` (rule 8, D-003): the installed Edge, never
 *    `playwright install` — no browser download, no native module;
 *  - `profileDir` is a **persistent context** (`profiles/<id>`, gitignored) when a
 *    source is `profile: true`: the browser profile is the only credential in this
 *    project (rule 17), and the pick session is where a reader logs in once and a
 *    list becomes visible;
 *  - the inspector is an **init script**, not a one-shot eval: the reader moves
 *    between pages of the publisher's site while choosing, and the picker must
 *    still be armed when they arrive;
 *  - `exposeBinding` runs **before** the navigation, so `window.newspaPick` exists
 *    at the first paint of the first page — a script that reports into a binding
 *    that is not there yet loses the click in silence.
 *
 * The body is one step per function, because a session is a sequence of things
 * that can each fail in their own named way, and a single 60-line `try` would
 * collapse those names into one.
 */

/** A pick window stays open this long by default: choosing is a human act. */
export const pickBudgetMs = 300_000;
const defaultNavTimeoutMs = 20_000;

export type PickLaunchFault =
  /** No browser to open: no Edge, no display, a refused launch. */
  | 'launch-refused'
  /** The page did not load: DNS, TLS, a refused connection, a nav timeout. */
  | 'nav-refused'
  /** The window stayed open and nothing was chosen. */
  | 'timed-out'
  /** The reader pressed Esc. */
  | 'cancelled'
  /** The window could not be armed, or the driver could not act in it. */
  | 'no-binding';

export type PickSessionResult =
  | {
      readonly ok: true;
      /** The browser's payload: `unknown` on purpose — `parseFingerprint` decides. */
      readonly payload: unknown;
      /** The address the window ended on, as the browser spells it. */
      readonly navigated: string;
    }
  | { readonly ok: false; readonly reason: PickLaunchFault; readonly detail: string };

export interface PickLaunchOptions {
  readonly url: string;
  /** Headless is for the test suite; a reader's pick is a window. */
  readonly headless: boolean;
  /** The whole session's budget, from the first navigation to the click. */
  readonly budgetMs?: number;
  /** The navigation's own budget; a hung publisher is a fault, not a wait. */
  readonly navTimeoutMs?: number;
  /** `profiles/<id>`, when the source is `profile: true` (rule 17). */
  readonly profileDir?: string;
  /** Rule 8's channel. A name, printed, never guessed. */
  readonly channel?: string;
  /**
   * The driver seam: called once the page is loaded and the inspector is armed. A
   * reader's pick is a hand on a mouse; a test's pick is this function, calling
   * `window.__newspaPickAt(selector)` or moving a real cursor with `page.mouse`.
   * One sequence, two drivers — which is the point.
   */
  readonly onArmed?: (page: Page) => Promise<void>;
}

interface Session {
  readonly page: Page;
  close: () => Promise<void>;
}

const fault = (reason: PickLaunchFault, detail: string): PickSessionResult => ({ ok: false, reason, detail });

const detailOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const openContext = async (options: PickLaunchOptions): Promise<Session> => {
  const shared = { channel: options.channel ?? 'msedge', headless: options.headless };
  if (options.profileDir === undefined) {
    const browser: Browser = await chromium.launch(shared);
    const context: BrowserContext = await browser.newContext({ javaScriptEnabled: true });
    return {
      page: await context.newPage(),
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  }
  const context = await chromium.launchPersistentContext(options.profileDir, {
    ...shared,
    // A throwaway `--user-data-dir` per run would silently undo `profile: true`.
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  return {
    page: context.pages()[0] ?? (await context.newPage()),
    close: async () => {
      await context.close();
    },
  };
};

/** The one message for a refused launch, with the advice that fits a server box. */
const launchDetail = (cause: unknown): string =>
  `no browser to pick in: ${detailOf(cause)} — a pick needs a window, so run it where a display is (on a headless machine, author the source on the machine that has one)`;

/** The binding and the inspector, both before the navigation. */
const armPage = async (page: Page, settle: (result: PickSessionResult) => void): Promise<PickSessionResult | null> => {
  try {
    await page.exposeBinding(PICK_BINDING, (_source, payload: unknown) => {
      settle(
        payload === null
          ? fault('cancelled', 'the reader pressed Esc: nothing was picked, and nothing was written')
          : { ok: true, payload, navigated: page.url() },
      );
    });
    await page.context().addInitScript({ content: INSPECTOR_SOURCE });
    return null;
  } catch (cause) {
    return fault('no-binding', `the pick window could not be armed: ${detailOf(cause)}`);
  }
};

const navigatePage = async (page: Page, url: string, navTimeoutMs: number): Promise<PickSessionResult | null> => {
  try {
    await page.goto(url, { timeout: navTimeoutMs, waitUntil: 'domcontentloaded' });
    return null;
  } catch (cause) {
    return fault('nav-refused', `${url} did not load: ${detailOf(cause)}`);
  }
};

/** The driver seam. A test that cannot act in the window is a fault, not a hang. */
const drivePage = async (
  page: Page,
  onArmed: ((page: Page) => Promise<void>) | undefined,
): Promise<PickSessionResult | null> => {
  if (onArmed === undefined) return null;
  try {
    await onArmed(page);
    return null;
  } catch (cause) {
    return fault('no-binding', `the driver could not act in the pick window: ${detailOf(cause)}`);
  }
};

/** The budget: a window nobody clicked in is a named timeout, and the window closes. */
const awaitChoice = async (chosen: Promise<PickSessionResult>, budgetMs: number): Promise<PickSessionResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<PickSessionResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          fault(
            'timed-out',
            `no click within ${String(budgetMs / 1000)} s: the window was closed, and nothing was written`,
          ),
        ),
      budgetMs,
    );
  });
  try {
    return await Promise.race([chosen, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const openPickSession = async (options: PickLaunchOptions): Promise<PickSessionResult> => {
  let session: Session;
  try {
    session = await openContext(options);
  } catch (cause) {
    return fault('launch-refused', launchDetail(cause));
  }

  try {
    let settle: (result: PickSessionResult) => void = () => undefined;
    const chosen = new Promise<PickSessionResult>((resolve) => {
      settle = resolve;
    });

    const armed = await armPage(session.page, settle);
    if (armed !== null) return armed;

    const loaded = await navigatePage(session.page, options.url, options.navTimeoutMs ?? defaultNavTimeoutMs);
    if (loaded !== null) return loaded;

    const driven = await drivePage(session.page, options.onArmed);
    if (driven !== null) return driven;

    return await awaitChoice(chosen, options.budgetMs ?? pickBudgetMs);
  } finally {
    await session.close();
  }
};
