import type { Locale } from './en.ts';

/**
 * German chrome. Typed against `Locale`, so a key added in English and not here
 * is a type error. `_one`/`_other` are the plural forms i18next resolves from
 * `Intl.PluralRules` for each language, given `count`.
 */
export const de = {
  masthead: {
    fallback: 'The Daily',
    tagline: 'Wie es kommt, auf dem eigenen Rechner',
    loading: 'Die Setzmaschine läuft an …',
  },
  nav: {
    paper: 'Die Zeitung',
    sources: 'Quellen',
    watchlist: 'Beobachtungsliste',
    search: 'Suche',
    health: 'Status',
    language: 'Sprache',
    theme: { light: 'Hell', dark: 'Dunkel', auto: 'System' },
  },
  section: {
    world: 'Ausland',
    politics: 'Politik',
    business: 'Wirtschaft',
    technology: 'Technik',
    science: 'Wissenschaft & Gesundheit',
    sport: 'Sport',
    culture: 'Kultur',
    opinion: 'Meinung',
    top: 'Titelseite',
  },
  story: {
    lead: 'Titelgeschichte',
    edited: 'geändert',
    edits_one: '1 Änderung',
    edits_other: '{{count}} Änderungen',
    new: 'neu',
    gone: 'nicht mehr gelistet',
    read: 'gelesen',
    markUnread: 'Als ungelesen markieren',
    source: 'Quelle',
    published: 'Erschienen',
    firstSeen: 'Zuerst gesehen',
    openStory: 'Geschichte bei {{source}} öffnen',
    noTeaser: 'Diese Quelle liefert keine Zusammenfassung.',
    changed: 'Was sich geändert hat',
    added: 'hinzugefügt',
    removed: 'entfernt',
  },
  time: {
    now: 'gerade eben',
    today: 'heute',
    yesterday: 'gestern',
  },
  health: {
    strip_one: '{{count}} Quelle braucht Aufmerksamkeit',
    strip_other: '{{count}} Quellen brauchen Aufmerksamkeit',
    allOk: 'Alle Quellen melden',
    noSources: 'Noch keine Quellen',
    state: {
      unknown: 'noch nicht abgerufen',
      ok: 'meldet',
      blocked: 'blockiert',
      'no-matches': 'Selektor findet nichts',
      restructured: 'Seite hat ihre Form geändert',
      error: 'fehlt',
      stale: 'meldet sich nicht mehr',
    },
    lastOk: 'Letzte gute Abfrage',
    lastTry: 'Letzter Versuch',
    since: 'seit',
    paused: 'pausiert',
    relaxHint: 'Abstand nach Fehlern auf {{cadence}} erhöht',
  },
  cadence: {
    everyMinute: 'jede Minute',
    minutes_one: '{{count}} Minute',
    minutes_other: '{{count}} Minuten',
    hours_one: '{{count}} Stunde',
    hours_other: '{{count}} Stunden',
    daily: 'täglich',
    weekly: 'wöchentlich',
    days_one: '{{count}} Tag',
    days_other: '{{count}} Tagen',
  },
  onboarding: {
    title: 'Noch nichts geholt',
    lead: 'newspa holt die Seiten, auf die du es zeigst, merkt sich, was dort stand, und druckt, was sich ändert. Die Seite beginnt bewusst leer: die Quellen gehören dir.',
    step1: 'Quelle hinzufügen',
    step1Body:
      'Der Picker schreibt die Quelldatei: `pnpm pick -- https://example.com` öffnet einen Browser, in dem du die Überschriften anklickst, und speichert `sources/example.json`.',
    step2: 'Zyklus starten',
    step2Body:
      '`pnpm start` holt jede Quelle einmal und hält sich danach an ihren eigenen Plan. Die Seite füllt sich, während der erste Zyklus endet.',
    step3: 'Behalten, was zählt',
    step3Body:
      'Beobachtungswörter heben eine Geschichte, Sperrwörter halten sie raus. `pnpm export --watchlist > watchlist.json` nimmt alles mit.',
    noSources: 'Keine Quelldateien in `sources/`.',
    sourcesFound_one: '{{count}} Quelldatei',
    sourcesFound_other: '{{count}} Quelldateien',
    cycleRunning: 'Erster Zyklus läuft: {{done}} von {{total}} Quellen geholt.',
    openSources: 'Quellenseite öffnen',
  },
  sources: {
    title: 'Quellen',
    // Das Feld in der Datumszeile und der Kopf des Dialogs: je ein Wort, weil das
    // Feld nach dem benannt ist, was es öffnet, und der Kopf der Name des Dialogs ist.
    open: 'Quellen',
    close: 'Schließen',
    disabled: 'Pausiert',
    empty:
      'Keine Quelldateien. `pnpm sources:init` kopiert die Beispiele nach `sources/`; „Neue Quelle“ schreibt eine aus einem Gerüst.',
    save: 'Speichern',
    cancel: 'Abbrechen',
    remove: 'Entfernen',
    confirmRemove: '{{label}} entfernen? Die Quelldatei wird gelöscht; die Geschichte bleibt.',
    // Das Feld, das WP14 unter die Zeitung setzt: die Leseliste, als Dateien. Jeder
    // Satz hier ist chrome (D-019); die Zeilen des Loaders werden nicht übersetzt.
    dir: 'Dateien in {{dir}}',
    loading: 'Die Quelldateien werden gelesen …',
    failed: 'Die Quellliste hat nicht geladen.',
    noState: 'noch nicht abgerufen',
    issuesCount_one: '{{value}} Problem in dieser Datei',
    issuesCount_other: '{{value}} Probleme in dieser Datei',
    noId: 'keine Id — der Loader konnte diese Datei nicht lesen, also kann sie auch nicht nach Id entfernt werden',
    textOf: 'Quelldatei-Text, {{file}}',
    edit: 'Bearbeiten',
    saving: 'Speichert …',
    deleting: 'Entfernt …',
    // Das Feld des Pickers (D-036): das eigene Verb der Zeitung, weil sich das Fenster
    // auf dem Rechner des Servers öffnet und das Element dort geklickt wird; der
    // Bericht füllt nur, er schreibt nie.
    pick: 'Picken',
    picking: 'Pickt …',
    newSource: 'Neue Quelle',
    readOnly:
      'Nur Lesen von dieser Adresse: Dieser Server hat keine Anmeldung, deshalb liefert und schreibt er die Leseliste — jede URL, jedes Überwachungswort und jede Notiz in deinen Quelldateien — nur an einen Peer auf diesem Rechner (Regel 18, D-034). Die Zeitung selbst ist von überall lesbar, wohin sie gebunden ist.',
    kindNames: { rss: 'RSS', json: 'JSON', html: 'HTML' },
    templates: { rss: 'Ein RSS-Feed', json: 'Ein JSON-Endpunkt', html: 'Eine HTML-Seite' },
    htmlNote:
      'Diese Selektoren schreibt der Picker per Klick: Das Feld PICK im Editor öffnet ein Fenster auf dem Rechner des Servers, `pnpm pick -- https://example.test` tut dasselbe im Terminal (D-036). Der Klick füllt die Datei, Speichern bleibt dein Schritt. Eine Quelle mit `"render": true` lehnt der Transport ab: Der Picker beweist die Selektoren an den Bytes, die der Poller holt, und eine Liste, die ein Skript baut, ist nicht darin (D-007).',
  },
  watchlist: {
    title: 'Beobachtungsliste',
    explain:
      'Beobachtungswörter heben eine Geschichte, Sperrwörter entfernen sie. Wörter treffen an Wortgrenzen, „ai" trifft also nie auf „said".',
    global: 'Überall',
    perSource: 'Für {{source}}',
    termPlaceholder: 'Nahverkehrsetat',
    add: 'Hinzufügen',
    weight: 'Quellengewicht',
    export: 'Export',
    import: 'Import',
    merge: 'Zusammenführen',
    replace: 'Ersetzen',
    empty: 'Noch keine Begriffe.',
  },
  search: {
    title: 'Archiv durchsuchen',
    placeholder: 'Alles, was newspa je gesehen hat',
    results_one: '{{count}} Treffer',
    results_other: '{{count}} Treffer',
    searching: 'Suche …',
    empty: 'Nichts gefunden.',
    recent: 'Letzte Beiträge',
  },
  paper: {
    loading: 'Die Setzmaschine läuft an…',
    failed: 'Die Zeitung antwortet nicht.',
    failedHint: 'pnpm start',
    theme: { toLight: 'Hell', toDark: 'Dunkel' },
    // Die zweite Achse (D-038): das Wort nennt den Zustand, den das Drücken bringt.
    contrast: { toNormal: 'Normal', toMore: 'Hoher Kontrast' },
    // D-039's install entry, in the iOS words the reader follows on that screen.
    install: { label: 'Installieren', recipe: 'Freigeben → Zum Startbildschirm hinzufügen' },
    // D-043's spine: the rail's accessible name is the app's only word here; every
    // square is an anchor whose text is the section's title.
    spine: { rail: 'Abschnittsschiene' },
    kicker: { new: 'Neu', edited: 'Geändert', gone: 'Archiviert', changed: 'Geändert' },
    byline: 'Von {{author}}',
    opensInNewTab: 'Die {{source}}-Meldung in einem neuen Tab öffnen',
    editSummary_one: '{{added}} Zeichen ergänzt, {{removed}} entfernt',
    editSummary_other: '{{added}} Zeichen ergänzt, {{removed}} entfernt',
    edited: { headline: 'Geändert' },
    stats: {
      items_one: '{{value}} Meldung',
      items_other: '{{value}} Meldungen',
      new_one: '{{value}} neu',
      new_other: '{{value}} neu',
      edited_one: '{{value}} geändert',
      edited_other: '{{value}} geändert',
      sources_one: '{{value}} Quelle',
      sources_other: '{{value}} Quellen',
      unhealthy_one: '{{value}} gestört',
      unhealthy_other: '{{value}} gestört',
      // D-039's stamp, in the strip's own words: `Stand 06:12` is what a masthead
      // prints for "this is the state as of", and it is the same fact the English line.
      cached: 'Stand {{at}}',
    },
    health: {
      headline: 'Quellen',
      allWell_one: '{{value}} Quelle, alle berichten',
      allWell_other: '{{value}} Quellen, alle berichten',
      state: {
        ok: 'ok',
        blocked: 'blockiert',
        noMatches: 'findet nichts',
        restructured: 'umgebaut',
        error: 'Fehler',
        stale: 'veraltet',
        unknown: 'unbekannt',
      },
      cadence_one: 'alle {{value}} Min.',
      cadence_other: 'alle {{value}} Min.',
      items_one: '{{value}} Meldung',
      items_other: '{{value}} Meldungen',
      neverFetched: 'nie abgerufen',
      lastPoll: 'letzte Abfrage {{ago}}',
      matches: '{{seen}} von {{expected}} Elementen getroffen',
    },
    onboarding: {
      title: 'Noch nichts auf dem Draht',
      lead: 'newspa druckt, was sich seit der letzten Abfrage geändert hat. Eine Quelle hinzufügen, dann läuft die Setzmaschine.',
      step1: 'Quelle im Browser auswählen: pnpm pick -- https://example.com',
      step2: 'Oder sources/example.json von Hand schreiben.',
      step3: 'http://127.0.0.1:8787 öffnen. Die Zeitung aktualisiert sich selbst.',
      command: 'pnpm pick -- https://example.com',
    },
  },
  errors: {
    load: 'Die Seite konnte ihren Zustand nicht laden.',
    retry: 'Erneut versuchen',
    offline: 'Der Server läuft nicht. Starte ihn mit `pnpm start`.',
    schema: 'Der Server sendete eine Form, die diese Build-Version nicht versteht.',
  },
} satisfies Locale;
