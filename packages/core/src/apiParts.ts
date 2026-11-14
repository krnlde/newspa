/**
 * The primitives two contracts share: a story tier, the word-diff shapes, the health
 * states and the source kinds.
 *
 * They live here so the read-side contract (`api.ts`) and the source-file contract
 * (`apiSources.ts`) can both use them **without importing each other** — a cycle
 * between two modules of `const` zod schemas is a TDZ at import time, and it shows up
 * as a suite that cannot load. Both modules re-export these, so a consumer imports the
 * wire from wherever it already does.
 */
import { z } from 'zod';

export const storyTierSchema = z.enum(['lead', 'front', 'section', 'brief']);

export const diffOpSchema = z.object({
  type: z.enum(['equal', 'insert', 'delete']),
  text: z.string(),
});

export const editReportSchema = z.object({
  ops: z.array(diffOpSchema),
  added: z.int().min(0),
  removed: z.int().min(0),
  similarity: z.number().min(0).max(1),
  meaningful: z.boolean(),
});

export const healthStateSchema = z.enum(['unknown', 'ok', 'blocked', 'no-matches', 'restructured', 'error', 'stale']);

/** The fetch kinds. `isSourceKind` in `types.ts` is the same list, and one owner of it. */
export const sourceKindSchema = z.enum(['rss', 'html', 'json']);
