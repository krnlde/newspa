/**
 * The two ways a display choice arrives at the page, in one place because
 * `index.html`'s pre-paint script spells the same order (D-002, D-038):
 *
 *  - **the url first.** A device on the wall is set by a link
 *    (`?theme=dark&contrast=more`): no clicks, no storage to clear, and the link is
 *    the whole configuration. It is **never written to storage** — a phone that
 *    opens a wall link once must not lose the choice it made for itself, and a
 *    device set by url has no stored state to fight with the link;
 *  - then `localStorage`, which is what the buttons in the strip write.
 *
 * A blocked storage (private mode, a sandboxed webview) is a choice that is not
 * remembered, stated by nothing: there is no failure to report, only a page that
 * starts from the url, the system, or the default.
 */
export const readParam = (name: string): string | null => {
  const search = globalThis.location?.search;
  return search === undefined ? null : new URLSearchParams(search).get(name);
};

export const readSaved = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const writeSaved = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // A blocked storage costs a remembered choice, nothing else.
  }
};
