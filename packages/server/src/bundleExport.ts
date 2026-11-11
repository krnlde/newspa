/**
 * `export --bundle` (WP5/WP11): the reading list and the config, in one file.
 *
 * Rule 18 makes this the **only backup** of `sources/` — that tree is gitignored on
 * purpose — which gives the command one hard rule and one soft one:
 *
 *  - **hard: a bundle is complete, or the command fails.** A source file that does
 *    not parse is *dropped* by the loader (the paper runs without it, which is right
 *    for a poll), and a backup that silently leaves it out is a backup that lies —
 *    the loss is discovered at restore time, when the original was the only copy. So
 *    any issue from `loadSources` is a `BundleRefusedError`, with every issue line in
 *    it, and **no file is written**;
 *  - **soft: a config that fell back to defaults is said, not fatal.** A fresh clone
 *    has no `config.json`, and refusing to back up a reading list because the
 *    masthead is default is not the reader's friend. The messages ride along, and the
 *    CLI prints them.
 *
 * The bytes are the config schema's own output, and the sources are sorted by id, so
 * two exports of an unchanged tree are byte-identical: a backup you can diff is a
 * backup you can trust.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUNDLE_FILENAME,
  type Bundle,
  bundleSchema,
  loadAppConfig,
  loadSources,
  parseBundle,
  type SourceIssue,
  serializeBundle,
} from 'newspa-config';

export class BundleRefusedError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `bundle refused: ${issues.length === 1 ? 'one source file' : `${String(issues.length)} source files`} did not parse`,
    );
    this.name = 'BundleRefusedError';
    this.issues = issues;
  }
}

export interface BundleResult {
  readonly file: string;
  readonly sources: number;
  readonly bytes: number;
  /** The config's own reports ("not present; using defaults"), never swallowed. */
  readonly messages: readonly string[];
  readonly bundle: Bundle;
}

const issueLines = (issues: readonly SourceIssue[]): string[] =>
  issues.map((issue) => `${issue.file} [${issue.reason}]: ${issue.messages.join('; ')}`);

/** Read a tree and write the bundle. `target` defaults to `<root>/newspa-bundle.json`. */
export const exportBundle = async (
  root: string,
  deps: { readonly now: () => Date; readonly target?: string },
): Promise<BundleResult> => {
  const load = await loadSources(join(root, 'sources'));
  const issues = issueLines(load.issues);
  if (issues.length > 0) throw new BundleRefusedError(issues);

  const { config, messages } = await loadAppConfig(join(root, 'config.json'));
  const text = serializeBundle({ appConfig: config, sources: load.sources, exportedAt: deps.now().toISOString() });
  const file = deps.target ?? join(root, BUNDLE_FILENAME);
  await writeFile(file, text, 'utf8');
  return {
    file,
    sources: load.sources.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    messages,
    bundle: bundleSchema.parse(JSON.parse(text) as unknown),
  };
};

/**
 * Read a bundle back and validate it, **before** anything is written (D-014: exports
 * are file formats, validated on the way in). The restore itself — writing
 * `sources/*.json` and `config.json` — is WP11's other half and is not built; this is
 * the half that decides whether a file is safe to restore from.
 */
export const readBundle = async (
  file: string,
): Promise<
  { readonly ok: true; readonly bundle: Bundle } | { readonly ok: false; readonly messages: readonly string[] }
> => parseBundle(await readFile(file, 'utf8'));
