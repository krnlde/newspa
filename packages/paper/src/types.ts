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
  /** The editor's entry, omitted when the app has no editor to open. */
  readonly sources?: SourcesControl;
}
