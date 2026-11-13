/**
 * UI chrome strings — the paper's own voice. Story text is never here: a
 * headline comes from its publisher, in the publisher's language, and
 * translating one is editing one (D-019).
 *
 * A TS module, not JSON: the type of `en` is what `de` is checked against in
 * `test/i18n.test.ts`, so a missing translation is a type error and a test
 * failure, not a silent English fallback at runtime.
 */
export const en = {
  masthead: {
    fallback: 'The Daily',
    tagline: 'As it happens, on your own machine',
    loading: 'Waking the presses…',
  },
  nav: {
    paper: 'The paper',
    sources: 'Sources',
    watchlist: 'Watchlist',
    search: 'Search',
    health: 'Health',
    language: 'Language',
    theme: { light: 'Light', dark: 'Dark', auto: 'System' },
  },
  section: {
    world: 'World',
    politics: 'Politics',
    business: 'Business',
    technology: 'Technology',
    science: 'Science & Health',
    sport: 'Sport',
    culture: 'Culture',
    opinion: 'Opinion',
    top: 'Top Stories',
  },
  story: {
    lead: 'Lead story',
    edited: 'edited',
    edits_one: '1 edit',
    edits_other: '{{count}} edits',
    new: 'new',
    gone: 'no longer listed',
    read: 'read',
    markUnread: 'Mark unread',
    source: 'Source',
    published: 'Published',
    firstSeen: 'First seen',
    openStory: 'Open the story at {{source}}',
    noTeaser: 'No summary from this source.',
    changed: 'What changed',
    added: 'added',
    removed: 'removed',
  },
  time: {
    now: 'just now',
    today: 'today',
    yesterday: 'yesterday',
  },
  health: {
    strip_one: '{{count}} source needs attention',
    strip_other: '{{count}} sources need attention',
    allOk: 'All sources reporting',
    noSources: 'No sources yet',
    state: {
      unknown: 'not polled yet',
      ok: 'reporting',
      blocked: 'blocked',
      'no-matches': 'selector matches nothing',
      restructured: 'page changed shape',
      error: 'failing',
      stale: 'gone quiet',
    },
    lastOk: 'Last good poll',
    lastTry: 'Last try',
    since: 'since',
    paused: 'paused',
    relaxHint: 'Polling slowed to {{cadence}} after failures',
  },
  cadence: {
    everyMinute: 'every minute',
    minutes_one: '{{count}} minute',
    minutes_other: '{{count}} minutes',
    hours_one: '{{count}} hour',
    hours_other: '{{count}} hours',
    daily: 'daily',
    weekly: 'weekly',
    days_one: '{{count}} day',
    days_other: '{{count}} days',
  },
  onboarding: {
    title: 'Nothing has been fetched yet',
    lead: 'newspa reads the pages you point it at, remembers what they said, and prints what changes. It starts with an empty page on purpose: the sources are yours.',
    step1: 'Add a source',
    step1Body:
      'The picker writes the source file: `pnpm pick -- https://example.com` opens a browser you click the headlines in, then saves `sources/example.json`.',
    step2: 'Start the cycle',
    step2Body:
      '`pnpm start` fetches every source once, then keeps to its own schedule. The page fills in as the first cycle finishes.',
    step3: 'Keep what matters',
    step3Body:
      'Watchwords push a story up, blockwords keep it out. `pnpm export --watchlist > watchlist.json` takes the whole thing with you.',
    noSources: 'No source files in `sources/`.',
    sourcesFound_one: '{{count}} source file',
    sourcesFound_other: '{{count}} source files',
    cycleRunning: 'First cycle running: {{done}} of {{total}} sources polled.',
    openSources: 'Open the sources page',
  },
  sources: {
    title: 'Sources',
    // The dateline strip's control and the modal's own head. One word each: the
    // control is named for the thing it opens, and the head is the dialog's
    // accessible name.
    open: 'Sources',
    close: 'Close',
    disabled: 'Disabled',
    empty:
      'No source files. `pnpm sources:init` copies the examples into `sources/`; “New source” writes one from a skeleton.',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Remove',
    confirmRemove: 'Remove {{label}}? The source file is deleted; the history stays.',
    // The panel WP14 prints below the paper: the reading list, as files. Every
    // line here is chrome (D-019); the loader's own issue lines are not translated.
    dir: 'Files in {{dir}}',
    loading: 'Reading the source files…',
    failed: 'The source list did not load.',
    noState: 'not polled yet',
    issuesCount_one: '{{value}} problem in this file',
    issuesCount_other: '{{value}} problems in this file',
    noId: 'no id — the loader could not read this file, so it cannot be removed by id',
    textOf: 'Source file text, {{file}}',
    edit: 'Edit',
    saving: 'Saving…',
    deleting: 'Removing…',
    // The picker's control (D-036): the paper's own verb, because the window opens on
    // the server's machine and the item is clicked there; the report only fills.
    pick: 'Pick',
    picking: 'Picking…',
    newSource: 'New source',
    readOnly:
      'Reading only from this address: this server has no authentication, so the reading list — every URL, watchword and note in your source files — is served and written only to a peer on this machine (rule 18, D-034). The paper itself is readable from anywhere it is bound.',
    kindNames: { rss: 'RSS', json: 'JSON', html: 'HTML' },
    templates: { rss: 'An RSS feed', json: 'A JSON endpoint', html: 'An HTML page' },
    htmlNote:
      'The picker writes these selectors by clicking them: the PICK control in the editor opens a window on the machine that runs the server, and `pnpm pick -- https://example.test` does the same from a terminal (D-036). The click fills the file; SAVE stays your act. A source with `"render": true` is refused by the transport: the pick proves selectors against the bytes the poller fetches, and a list a script builds is not in them (D-007).',
  },
  watchlist: {
    title: 'Watchlist',
    explain:
      'Watchwords raise a story, blockwords remove it. Terms match at word boundaries, so “ai” never fires on “said”.',
    global: 'Everywhere',
    perSource: 'For {{source}}',
    termPlaceholder: 'transit budget',
    add: 'Add',
    weight: 'Source weight',
    export: 'Export',
    import: 'Import',
    merge: 'Merge',
    replace: 'Replace',
    empty: 'No terms yet.',
  },
  search: {
    title: 'Search the archive',
    placeholder: 'Everything newspa has ever seen',
    results_one: '{{count}} result',
    results_other: '{{count}} results',
    searching: 'Searching…',
    empty: 'Nothing matched.',
    recent: 'Recent items',
  },
  paper: {
    loading: 'Waking the presses…',
    failed: 'The paper is not answering.',
    failedHint: 'pnpm start',
    theme: { toLight: 'Light', toDark: 'Dark' },
    // The second axis (D-038): the word names the state the press gives, as the theme's does.
    contrast: { toNormal: 'Plain', toMore: 'High contrast' },
    // The install entry (WP16, D-039): one word on the control, and the recipe for
    // the browser that has no control to offer. iOS's own words, because a reader
    // follows them on iOS's own screen.
    install: { label: 'Install', recipe: 'Share → Add to Home Screen' },
    // The spine (D-043): the rail's accessible name is the app's only word here.
    // Every square is an anchor whose text is the section's title, so a screen
    // reader hears the section's own word, and there is no menu to name.
    spine: { rail: 'Section rail' },
    kicker: { new: 'New', edited: 'Edited', gone: 'Archived', changed: 'Changed' },
    byline: 'By {{author}}',
    opensInNewTab: 'Open the {{source}} story in a new tab',
    editSummary_one: '{{added}} characters added, {{removed}} removed',
    editSummary_other: '{{added}} characters added, {{removed}} removed',
    edited: { headline: 'Edited' },
    stats: {
      items_one: '{{value}} story',
      items_other: '{{value}} stories',
      new_one: '{{value}} new',
      new_other: '{{value}} new',
      edited_one: '{{value}} edited',
      edited_other: '{{value}} edited',
      sources_one: '{{value}} source',
      sources_other: '{{value}} sources',
      unhealthy_one: '{{value}} unhealthy',
      unhealthy_other: '{{value}} unhealthy',
      // The worker's stamp (WP16, D-039). The dateline strip's own vocabulary, not a
      // widget: a cached edition that presents itself as news is rule 5's silent zero
      // with a masthead on it, so the line says what it is and when it was written.
      cached: 'cached {{at}}',
    },
    health: {
      headline: 'Sources',
      allWell_one: '{{value}} source, all reporting',
      allWell_other: '{{value}} sources, all reporting',
      state: {
        ok: 'ok',
        blocked: 'blocked',
        noMatches: 'matches nothing',
        restructured: 'restructured',
        error: 'error',
        stale: 'stale',
        unknown: 'unknown',
      },
      cadence_one: 'every {{value}} min',
      cadence_other: 'every {{value}} min',
      items_one: '{{value}} story',
      items_other: '{{value}} stories',
      neverFetched: 'never fetched',
      lastPoll: 'last poll {{ago}}',
      matches: 'matched {{seen}} of {{expected}} elements',
    },
    onboarding: {
      title: 'Nothing on the wire yet',
      lead: 'newspa prints what changed since the last poll. Add a source, and the presses start.',
      step1: 'Pick a source in a browser: pnpm pick -- https://example.com',
      step2: 'Or write sources/example.json by hand.',
      step3: 'Open http://127.0.0.1:8787. The paper updates itself.',
      command: 'pnpm pick -- https://example.com',
    },
  },
  errors: {
    load: 'The page could not load its state.',
    retry: 'Try again',
    offline: 'The server is not running. Start it with `pnpm start`.',
    schema: 'The server sent a shape this build does not understand.',
  },
} as const;

/**
 * The shape every locale must have, with `string` at the leaves. `typeof en`
 * cannot be the contract: `as const` makes each leaf its own literal type, so a
 * German string would fail to satisfy an English literal. This keeps the key
 * tree — which is the thing that can go missing — and forgets the text.
 *
 * The recursion lives in its own generic, not inside `Locale`: a mapped type
 * that mentions `Locale` in its own body is a circular reference (TS2615).
 */
type DeepStrings<T> = T extends string ? string : { readonly [K in keyof T]: DeepStrings<T[K]> };

export type Locale = DeepStrings<typeof en>;
