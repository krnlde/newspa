/**
 * The boundary of the read side, read as **text**: the rule that defines
 * `edition.ts` is that it owns no language and no clock (D-019), and the rule
 * that defines this package is that it renders nothing and opens no database
 * file of its own.
 *
 * Text, not the module graph: a formatter imported from a helper is exactly the
 * regression to catch, and a `node:sqlite` import is invisible to a type test.
 *
 * The needles are call sites and import specifiers, never bare words, so prose
 * that *explains* the rule (which names `Intl` and `new Date` deliberately) is
 * not flagged.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * happy-dom replaces the global `URL` with its own class and `node:fs` rejects a
 * URL object it did not build, so these paths come from **node:url**'s own `URL`,
 * resolved from a module-relative URL: the suite passes from any working
 * directory, and `src` is never found by accident.
 */
const SRC_DIR = fileURLToPath(new NodeUrl('../src/', import.meta.url));
const MANIFEST = fileURLToPath(new NodeUrl('../package.json', import.meta.url));

/** The modules that exist today; a new file has to be listed here, on purpose. */
const SRC_FILES: readonly string[] = [
  'edition.ts',
  'index.ts',
  'poll.ts',
  'pollBaseline.ts',
  'pollDeps.ts',
  'pollHealth.ts',
  'pollItems.ts',
  'pollTypes.ts',
  'pollVerdicts.ts',
  'state.ts',
];

/** The pure assembler: rows in, wire out. No language, no clock, no translation library. */
const ASSEMBLER = 'edition.ts';

const BANNED_IN_ASSEMBLER: readonly string[] = [
  'Intl.',
  'toLocale',
  'Date.now()',
  'new Date(',
  'useTranslation',
  "from 'i18next'",
  "from 'react-i18next'",
  'new Intl',
];

/** Nothing here renders the paper, and nothing here opens SQLite. */
const BANNED_IN_SRC: readonly string[] = [
  "from 'newspa-paper'",
  'from "newspa-paper"',
  "from 'better-sqlite3'",
  'from "better-sqlite3"',
  "require('node:sqlite')",
  "from 'node:sqlite'",
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const sectionOf = (section: string): string[] => {
  const manifest = asRecord(JSON.parse(readFileSync(MANIFEST, 'utf8')));
  return Object.keys(asRecord(manifest[section])).sort();
};

const sourceOf = (file: string): string => readFileSync(join(SRC_DIR, file), 'utf8');

describe('the modules the boundary was written for', () => {
  it('are exactly the pinned list, so the scan can never go vacuous', () => {
    expect(
      readdirSync(SRC_DIR)
        .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
        .sort(),
    ).toEqual(SRC_FILES);
  });

  it('include an assembler with real content, so a blanked file cannot pass the ban', () => {
    const text = sourceOf(ASSEMBLER);
    for (const needle of ['export const editionOf', 'EditionInput', 'teaserFor', 'tierFor', 'buildEdition'])
      expect(text, needle).toContain(needle);
  });
});

describe('the assembler', () => {
  it('owns no language, no clock and no translation library (D-019)', () => {
    const text = sourceOf(ASSEMBLER);
    for (const needle of BANNED_IN_ASSEMBLER) expect(text, `${ASSEMBLER} contains ${needle}`).not.toContain(needle);
  });

  it('is not vacuous: the ban is real because the clock enters one file away', () => {
    // `state.ts` is the composition root, so it is where `new Date()` and the
    // dateline's `Intl` are allowed to live. If that ever moves into the
    // assembler, the test above fails and this one says which file grew.
    expect(sourceOf('state.ts')).toContain('new Date()');
    expect(sourceOf('state.ts')).toContain('Intl.DateTimeFormat');
    expect(sourceOf('edition.ts')).not.toContain('Intl');
  });
});

describe('the pipeline', () => {
  /** The rungs and the item pass: every instant they use is handed to them. */
  const PURE_PIPELINE: readonly string[] = [
    'pollVerdicts.ts',
    'pollBaseline.ts',
    'pollHealth.ts',
    'pollItems.ts',
    'pollTypes.ts',
    'pollDeps.ts',
  ];

  it('reads the clock in one place, so one poll’s rows all carry one instant', () => {
    // `pollOne` reads `now` once and passes that instant to the snapshot, the
    // items, the events and the scorer. A rung that read the clock itself would
    // stamp a poll over two instants, and every test would drift by a second.
    for (const file of PURE_PIPELINE) {
      const text = sourceOf(file);
      for (const needle of ['new Date(', 'Date.now()'])
        expect(text, `${file} contains ${needle}`).not.toContain(needle);
    }
    // Non-vacuous: the clock lives in the composition root, as it does for `state.ts`.
    expect(sourceOf('poll.ts')).toContain('new Date()');
  });

  it('writes from one file, so a poll cannot leave half a paper behind', () => {
    // One transaction, one snapshot, one validator row, one health patch. A
    // second call site for any of these is a second write path to keep in step.
    const writers = ['snapshots.record(', 'validators.write(', 'countFastPath(', 'setHealth('];
    for (const needle of writers) {
      const writersOf = SRC_FILES.filter((file) => sourceOf(file).includes(needle));
      expect(writersOf, `${needle} has more than one call site`).toEqual(['poll.ts']);
    }
  });
});

describe('every module in src', () => {
  it('renders nothing and opens no database: the server serves JSON, and SQLite is newspa-db’s', () => {
    for (const file of SRC_FILES) {
      const text = sourceOf(file);
      for (const needle of BANNED_IN_SRC) expect(text, `${file} contains ${needle}`).not.toContain(needle);
    }
  });
});

describe('the package manifest', () => {
  it('depends on the four workspace packages the read side stands on', () => {
    const dependencies = sectionOf('dependencies');
    for (const name of ['newspa-config', 'newspa-core', 'newspa-db', 'newspa-fetch', 'zod'])
      expect(dependencies, name).toContain(name);
  });

  it('names the barrel as its only entry point, and that barrel exists', () => {
    const manifest = asRecord(JSON.parse(readFileSync(MANIFEST, 'utf8')));
    expect(asRecord(manifest['exports'])).toEqual({ '.': './src/index.ts' });
    expect(readdirSync(SRC_DIR)).toContain('index.ts');
  });
});
