import type { ItemView } from 'newspa-core';

/**
 * The props every paper component is built from.
 *
 * **No string in this package is translated, and no date is formatted here.**
 * i18n is a boundary (D-019): the paper ships **locale-free parts**, and the
 * app hands in finished strings and formatter functions built from i18next's
 * current `language`. A formatter created at module load would be a frozen
 * language, so the formatters arrive as functions, per render.
 *
 * `slot` is a **display** slot, not `ItemView.tier`: the lead is one story, a
 * section leader is the first story of a section, and the same item is a plain
 * `story` in the archive. The paper decides what is big; the server decides
 * what matters. The name is `slot`, not `role`, because `role` is an ARIA
 * attribute and a component prop named `role` is a lint false positive waiting
 * to happen.
 */
export type StorySlot = 'lead' | 'leader' | 'story' | 'brief';

/** Finished words for one story. The app owns the language; this owns the layout. */
export interface StoryLabels {
  /** The kicker of a story that has never been seen: `"New"`. */
  readonly newKicker: string;
  /** The kicker of a story whose text changed: `"Edited"`. */
  readonly editedKicker: string;
  /**
   * The kicker of a story the source **stopped listing** (D-029's `gone` event):
   * `"Archived"`. It is not an obituary and not a deletion — the paper keeps
   * polling the source, the row stays, and the link still opens. A door the
   * source closed, named as one.
   */
  readonly goneKicker: string;
  /** The meta line's word for a later change: `"changed 3 hours ago"`. */
  readonly changedLabel: string;
  /** `"By Ann Example"` — the app composes it with its own word order. */
  readonly byline: (author: string) => string;
  /** The accessible name of the link: `"Open the BBC story in a new tab"`. */
  readonly opensInNewTab: (sourceLabel: string) => string;
  /** `"3 characters added, 1 removed"` — the diff summary in the `edited` strip. */
  readonly editSummary: (added: number, removed: number) => string;
}

/** A date, an instant, an age — formatted by the app, in the app's language. */
export interface FormatProps {
  /** `publishedAt` as `"06:40"` today, `"8 Nov"` this year, `"8 Nov 2025"` older. */
  readonly published: (iso: string | null) => string;
  /** `lastChangedAt` as an age: `"3 hours ago"`. */
  readonly ago: (iso: string) => string;
}

export interface StoryProps {
  readonly item: ItemView;
  readonly slot: StorySlot;
  readonly labels: StoryLabels;
  readonly format: FormatProps;
  /** Lead and section leaders only, and only when the source has an image. */
  readonly showImage: boolean;
}

export interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly blurb: string | null;
  readonly items: readonly ItemView[];
  readonly labels: StoryLabels;
  readonly format: FormatProps;
}

/**
 * The editor's entry: the one control in the dateline strip that opens the sources
 * modal (WP14).
 *
 * A label and an act, and no data. That is deliberate twice over: the paper prints
 * news, so the reading list is edited in a modal **above** the sheet, not inside it;
 * and the list is fetched only when the modal is opened — its answer is the reader's
 * source files, which rule 18 keeps to a loopback peer, so a page load asks for it
 * only when a reader asked to see it.
 */
export interface SourcesControl {
  readonly label: string;
  /**
   * The act, handed the control that asked for it: the modal unmounts when it
   * closes, so the app has to remember **where the reader was** to put them back
   * there. `document.activeElement` would work in a browser and is `<body>` in a
   * test that fires a click without focusing, so the event's own target is the
   * honest source.
   */
  readonly onOpen: (control: HTMLElement) => void;
}

export interface InstallControl {
  readonly mode: InstallMode;
  readonly label: string;
  /**
   * The words for a browser that offers no prompt (iOS Safari, D-039's named
   * case): printed as the strip's line, because a control that is silently absent
   * is a feature the reader cannot find.
   */
  readonly recipe: string;
  readonly onInstall: () => void;
}

/**
 * The install control (WP16, D-039): the dateline strip's entry, in the page's one
 * control row — **never a second overlay** (D-035: the sources editor is the page's
 * one, and the page has exactly one). Three modes, and the app decides which,
 * because only the app knows what this browser offered:
 *
 *  - `prompt`: the browser has an install prompt in hand, so the strip prints a
 *    control that asks for it;
 *  - `recipe`: the browser offers nothing (iOS Safari is the named case), so the
 *    strip prints the words that work **there**;
 *  - `none`: nothing to print — the app is installed already, or this browser has
 *    neither prompt nor recipe and inventing one is worse than silence.
 *
 * The words are the app's, as everywhere in the paper (D-019).
 */
export type InstallMode = 'prompt' | 'recipe' | 'none';

/**
 * One section's square on the rail (D-043). `id` is the anchor the panel's title
 * points at — `Section.tsx` stamps `id="section-<id>"` on every section, so the
 * spine adds no ids and invents no targets; `active` is the section the reader
 * is in.
 */
export interface SpineMark {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
}

/**
 * One **place** on the rail (D-043): `at` is its fraction of the rail (0..1), and
 * `marks` are the sections that begin there. The front page prints WORLD, TOP
 * STORIES and POLITICS in one row, so those three heads are at one y, and the
 * reader's ruling is that the rail says so: **the squares of one place sit side
 * by side in one cluster**, and each square names its own section when the
 * pointer is on it. Not one square stacked under the next, which is a column the
 * page does not have.
 */
export interface SpineGroup {
  readonly at: number;
  readonly marks: readonly SpineMark[];
}

/**
 * The spine's props: the clusters, and the rail's accessible name — the only word
 * the app owns here (D-019). A square's name is its section's title, which is the
 * publisher's, and an anchor's accessible name is its text, so the paper needs no
 * label of its own: there is no menu to name, because there is no menu.
 */
export interface SpineProps {
  readonly groups: readonly SpineGroup[];
  readonly railLabel: string;
}

/**
 * The stock's two axes (D-038): `theme` answers "which stock", `contrast` answers
 * "how hard". They are **not** one enum of four modes: the pair composes, the CSS
 * rebinds the same token names under `[data-theme]` and `[data-contrast]`, and a
 * wall device can be set by URL (`?theme=dark&contrast=more`) with no clicks.
 */
export type Contrast = 'normal' | 'more';

export interface MastheadProps {
  readonly name: string;
  readonly tagline: string;
  readonly dateline: string;
  /** One line of the stats strip: `"38 stories · 6 new · 2 edited"`. */
  readonly summary: string;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  /** The switcher's own words, and its accessible name. */
  readonly themeLabel: string;
  /**
   * The install control (WP16, D-039): the third entry in the strip, in the same
   * `CONTROL` vocabulary as the other two. Omitted, and the strip prints what it
   * printed before. The app owns the mode, because only the app knows what this
   * browser offered: a prompt in hand, the recipe for the browser that has none,
   * or silence.
   */
  readonly install?: InstallControl | undefined;
  /**
   * The contrast axis, omitted when the app has no contrast control to offer. The
   * strip prints the button only when the app asks for it: a control that does
   * nothing is a lie, and the paper owns no opinion about which axes to expose.
   */
  readonly contrast?: Contrast | undefined;
  readonly onToggleContrast?: (() => void) | undefined;
  readonly contrastLabel?: string | undefined;
  /** The editor's entry, omitted when the app has no editor to open. */
  readonly sources?: SourcesControl;
}
