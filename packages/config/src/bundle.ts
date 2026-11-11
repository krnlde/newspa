import { z } from 'zod';
import { appConfigSchema, type SourceSpec, sourceSchema } from './schema.ts';
import { BUNDLE_SCHEMA_URL } from './schemaUrls.ts';

/**
 * The bundle: one file that is the whole reading list (docs/decisions.md D-014).
 *
 * Rule 18 makes this the **only backup** of `sources/` — that tree is gitignored on
 * purpose, because a source definition is a statement about what a reader cares
 * about. So a bundle is not a nicety, and its rules are the rules of a backup:
 *
 *  - **it validates on the way in** (`$schemaVersion` gates the shape, zod narrows
 *    every source through the same `sourceSchema` the loader uses), so a reader
 *    finds out about a broken bundle at restore time **before** anything is written;
 *  - **it is complete, or it is an error.** A bundle that silently drops the source
 *    file that stopped parsing is a backup that lies, and the loss is discovered
 *    after the original was the only copy. So `serializeBundle` refuses a source the
 *    schema rejects, and the caller that gathered the watchlist passes the loader's
 *    issues in, where they become a failure, not a shorter list;
 *  - **it is a private file.** It carries every URL, label, note and `profile: true`
 *    fact. `.gitignore` names it.
 */
export const BUNDLE_SCHEMA_VERSION = 'newspa.bundle.v1';

export const bundleSchema = z.object({
  /** URL of the published JSON Schema; ignored by the loader, used by editors. */
  $schema: z.url().optional(),
  $schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION).default(BUNDLE_SCHEMA_VERSION),
  exportedAt: z.iso.datetime().optional(),
  /**
   * The app config, as the config schema would write it (defaults included).
   * `prefault`, not `default`: the config schema is all nested defaults, and
   * `default` wants a finished `AppConfig` while `prefault` feeds `{}` through the
   * schema - the same reason `appConfigSchema` itself prefaults every section.
   */
  appConfig: appConfigSchema.prefault({}),
  sources: z.array(sourceSchema).default([]),
});

export type Bundle = z.infer<typeof bundleSchema>;

export type ParsedBundle =
  | { readonly ok: true; readonly bundle: Bundle }
  | { readonly ok: false; readonly messages: readonly string[] };

/** Parse a bundle's text. Every failure is a line, and every line is the whole list. */
export const parseBundle = (text: string): ParsedBundle => {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (cause) {
    // `String(cause)`, not `cause.message`: a parse failure is a SyntaxError whose
    // own text names the offset, and the branch a type test would need is one the
    // JSON grammar cannot produce.
    return { ok: false, messages: [`not JSON: ${String(cause)}`] };
  }
  const parsed = bundleSchema.safeParse(raw);
  if (parsed.success) return { ok: true, bundle: parsed.data };
  return {
    ok: false,
    messages: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
};

/**
 * The bundle's text. `sources` are the loader's own `SourceSpec` values, sorted by
 * id so two exports of one tree are byte-identical (a backup you cannot diff is a
 * backup you cannot trust).
 */
export const serializeBundle = (input: {
  readonly appConfig: Bundle['appConfig'];
  readonly sources: readonly SourceSpec[];
  readonly exportedAt: string;
}): string => {
  const bundle = bundleSchema.parse({
    $schema: BUNDLE_SCHEMA_URL,
    $schemaVersion: BUNDLE_SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    appConfig: input.appConfig,
    sources: [...input.sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
  return `${JSON.stringify(bundle, null, 2)}\n`;
};

/** The filename a bundle is written to, and the name `.gitignore` uses. */
export const BUNDLE_FILENAME = 'newspa-bundle.json';
