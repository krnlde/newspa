import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The rule that defines this package (D-019, `packages/paper/src/types.ts`):
 * **no string in the paper is translated, and no date is formatted here.** Every
 * word and every instant arrives through props, built by the app from i18next's
 * current `language` — a formatter created at module load is a frozen language.
 *
 * This is the one test that stops a future contributor from "just formatting a
 * date in the component", so it reads the package's own `package.json` and every
 * `src/*.ts(x)` file as text. Text, not the module graph, because a formatter
 * imported from a helper module is exactly the regression to catch.
 *
 * The needles are import specifiers and call sites, never bare words: the
 * comment in `types.ts` names i18next to explain the rule, and a scan that
 * flagged prose would be ignored the first time it annoyed someone.
 */

/**
 * happy-dom replaces the global `URL` with its own class, and `node:fs` rejects
 * a URL object it did not build, so these paths come from **node:url**'s own
 * `URL`, resolved from a module-relative URL: the suite passes from any working
 * directory, and `src` is never found by accident.
 */
const SRC_DIR = fileURLToPath(new NodeUrl('../src/', import.meta.url));
const MANIFEST = fileURLToPath(new NodeUrl('../package.json', import.meta.url));

/**
 * The modules that exist today; a new file has to be listed here, on purpose.
 * `EditedStrip.tsx`, `FrontPage.tsx` and `blockHead.ts` are the split of the
 * page's composition, and all three are markup: no string is formatted, no
 * clock is read, so the boundary holds for the new files exactly as it did for
 * the old ones. `SourcesPanel.tsx`, `SourceRow.tsx`, `SourceEditor.tsx`,
 * `SourcesModal.tsx` and `sourceStyle.ts` are the same rule in markup — the panel's
 * every word arrives in `labels`, the modal's head and close control arrive in
 * `labels`, it keeps only local editing state, and the style module is class
 * strings, so the sources editor is inside the boundary, not an exception.
 * `SourcesNew.tsx` is the skeleton menu, split out of the panel for rule 1's cap:
 * the same markup and the same rule — a local draft, every word in `labels` — and the
 * pick's fill stamp arrives as a prop, so no clock is read here either (D-036).
 */
const SRC_FILES: readonly string[] = [
  'EditedStrip.tsx',
  'FrontPage.tsx',
  'HealthStrip.tsx',
  'Masthead.tsx',
  'Paper.tsx',
  'Section.tsx',
  'SourceEditor.tsx',
  'SourceRow.tsx',
  'SourcesModal.tsx',
  'SourcesNew.tsx',
  'SourcesPanel.tsx',
  'Story.tsx',
  'blockHead.ts',
  'index.ts',
  'sourceStyle.ts',
  'types.ts',
];

const BANNED_IN_SRC: readonly string[] = [
  "from 'i18next'",
  'from "i18next"',
  "from 'react-i18next'",
  'from "react-i18next"',
  'useTranslation',
  'Intl.',
  'toLocale',
  'Date.now()',
  'new Date(',
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const sectionOf = (section: string): string[] => {
  const manifest = asRecord(JSON.parse(readFileSync(MANIFEST, 'utf8')));
  return Object.keys(asRecord(manifest[section])).sort();
};

const sourceOf = (file: string): string => readFileSync(join(SRC_DIR, file), 'utf8');

describe('the package manifest', () => {
  it('declares no translation library, in any section', () => {
    const all = [...sectionOf('dependencies'), ...sectionOf('devDependencies'), ...sectionOf('peerDependencies')];
    expect(all.filter((name) => name.includes('i18n'))).toEqual([]);
  });

  it('depends at runtime only on the wire contract it renders', () => {
    expect(sectionOf('dependencies')).toEqual(['newspa-core']);
  });

  it('keeps react a peer, so the app owns the copy that renders', () => {
    expect(sectionOf('peerDependencies')).toEqual(['react', 'react-dom']);
  });
});

describe('the source of the paper', () => {
  it('is exactly the modules this boundary was written for, so the scan is never vacuous', () => {
    expect(
      readdirSync(SRC_DIR)
        .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
        .sort(),
    ).toEqual(SRC_FILES);
  });

  it('imports no translation library, formats no string, and reads no clock', () => {
    for (const file of SRC_FILES) {
      const text = sourceOf(file);
      for (const needle of BANNED_IN_SRC) expect(text.includes(needle), `${file} contains ${needle}`).toBe(false);
    }
  });

  it('is browser-safe: no node: import, because the web app bundles these components', () => {
    for (const file of SRC_FILES) expect(sourceOf(file), file).not.toContain("from 'node:");
  });

  it('takes every word and every instant as a prop, in the props types it declares', () => {
    const all = SRC_FILES.map(sourceOf).join('\n');
    for (const prop of [
      'labels: StoryLabels',
      'labels: HealthLabels',
      'labels: PaperLabels',
      'labels: SourcesLabels',
      'labels: SourcesModalLabels',
      'format: FormatProps',
      'dateline: string',
      'summary: string',
      'onToggleTheme: () => void',
    ])
      expect(all, prop).toContain(prop);
  });
});
