import { z } from 'zod';

/**
 * The watchlist: your interests, as a portable document (docs/decisions.md
 * D-014). It lives in two places at runtime — global `scoring.*` in
 * `newspa.config.json` and per-source `watchwords`/`weight` in
 * `sources/*.json` — and this module is the gather/merge/split layer between
 * them and the exported file.
 *
 * `$schema` is a real URL (the generated JSON Schema's `$id`), which is what
 * editors resolve. The loader gates on `$schemaVersion`, so an old export is a
 * clear error, never a silent partial migration.
 */

export const WATCHLIST_SCHEMA_VERSION = 'newspa.watchlist.v1';

const scopeSchema = z.union([z.literal('global'), z.object({ sourceId: z.string().min(2).max(64) })]);

export const watchTermSchema = z.object({
  term: z.string().min(1).max(80),
  kind: z.enum(['watch', 'block']).default('watch'),
  scope: scopeSchema.default('global'),
  note: z.string().max(200).optional(),
});

export const watchWeightSchema = z.object({
  sourceId: z.string().min(2).max(64),
  weight: z.number().min(0).max(5),
});

export const watchlistSchema = z.object({
  /** URL of the published JSON Schema; ignored by the loader, used by editors. */
  $schema: z.url().optional(),
  $schemaVersion: z.literal(WATCHLIST_SCHEMA_VERSION).default(WATCHLIST_SCHEMA_VERSION),
  exportedAt: z.iso.datetime().optional(),
  terms: z.array(watchTermSchema).default([]),
  weights: z.array(watchWeightSchema).default([]),
});

export type WatchTerm = z.infer<typeof watchTermSchema>;
export type WatchWeight = z.infer<typeof watchWeightSchema>;
export type Watchlist = z.infer<typeof watchlistSchema>;
export type WatchScope = z.infer<typeof scopeSchema>;

export const scopeKey = (scope: WatchScope): string => (scope === 'global' ? 'global' : `source:${scope.sourceId}`);

export const parseWatchlist = (
  text: string,
): { ok: true; watchlist: Watchlist } | { ok: false; messages: string[] } => {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    return { ok: false, messages: [`not JSON: ${cause instanceof Error ? cause.message : 'unparseable'}`] };
  }
  const parsed = watchlistSchema.safeParse(json);
  if (parsed.success) return { ok: true, watchlist: parsed.data };
  const version = (json as { $schemaVersion?: unknown }).$schemaVersion;
  if (typeof version === 'string' && version !== WATCHLIST_SCHEMA_VERSION) {
    return {
      ok: false,
      messages: [`unsupported $schemaVersion "${version}"; this build reads ${WATCHLIST_SCHEMA_VERSION}`],
    };
  }
  return {
    ok: false,
    messages: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
};

const termKey = (term: WatchTerm): string => `${term.kind}|${scopeKey(term.scope)}|${term.term.toLowerCase()}`;

/** Union, deduped by (kind, scope, term). Deterministic order, so exports diff cleanly. */
export const mergeWatchlists = (base: Watchlist, incoming: Watchlist): Watchlist => {
  const terms = new Map<string, WatchTerm>();
  for (const term of [...base.terms, ...incoming.terms]) terms.set(termKey(term), term);
  const weights = new Map<string, WatchWeight>();
  for (const weight of [...base.weights, ...incoming.weights]) weights.set(weight.sourceId, weight);
  return {
    $schemaVersion: WATCHLIST_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    terms: sortTerms([...terms.values()]),
    weights: [...weights.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  };
};

const sortTerms = (terms: readonly WatchTerm[]): WatchTerm[] =>
  [...terms].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      scopeKey(a.scope).localeCompare(scopeKey(b.scope)) ||
      a.term.localeCompare(b.term),
  );

export interface WatchlistSourceView {
  id: string;
  weight: number;
  watchwords: readonly string[];
  blockwords: readonly string[];
}

export interface WatchlistGlobalView {
  watchwords: readonly string[];
  blockwords: readonly string[];
}

/** Gather: runtime config + source files → one document. */
export const gatherWatchlist = (global: WatchlistGlobalView, sources: readonly WatchlistSourceView[]): Watchlist => ({
  $schemaVersion: WATCHLIST_SCHEMA_VERSION,
  exportedAt: new Date().toISOString(),
  terms: sortTerms([
    ...global.watchwords.map((term) => ({ term, kind: 'watch' as const, scope: 'global' as const })),
    ...global.blockwords.map((term) => ({ term, kind: 'block' as const, scope: 'global' as const })),
    ...sources.flatMap((source) => [
      ...source.watchwords.map((term) => ({ term, kind: 'watch' as const, scope: { sourceId: source.id } })),
      ...source.blockwords.map((term) => ({ term, kind: 'block' as const, scope: { sourceId: source.id } })),
    ]),
  ]),
  weights: sources
    .map((source) => ({ sourceId: source.id, weight: source.weight }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
});

export interface SourceTerms {
  watchwords: string[];
  blockwords: string[];
  weight: number | null;
}

/** Mutable output: callers write these back into config and source files. */
export interface ParsedWatchlist {
  global: { watchwords: string[]; blockwords: string[] };
  bySource: Map<string, SourceTerms>;
}

/** Split a document back into the two places it lives at runtime. */
export const splitWatchlist = (watchlist: Watchlist): ParsedWatchlist => {
  const global: { watchwords: string[]; blockwords: string[] } = { watchwords: [], blockwords: [] };
  const bySource = new Map<string, SourceTerms>();
  const ensure = (sourceId: string): SourceTerms => {
    const existing = bySource.get(sourceId);
    if (existing !== undefined) return existing;
    const created: SourceTerms = { watchwords: [], blockwords: [], weight: null };
    bySource.set(sourceId, created);
    return created;
  };

  for (const term of watchlist.terms) {
    if (term.scope === 'global') {
      if (term.kind === 'watch') global.watchwords.push(term.term);
      else global.blockwords.push(term.term);
      continue;
    }
    const target = ensure(term.scope.sourceId);
    if (term.kind === 'watch') target.watchwords.push(term.term);
    else target.blockwords.push(term.term);
  }
  for (const weight of watchlist.weights) ensure(weight.sourceId).weight = weight.weight;
  return { global, bySource };
};

export const serializeWatchlist = (watchlist: Watchlist, schemaUrl: string): string =>
  `${JSON.stringify({ $schema: schemaUrl, ...watchlist }, null, 2)}\n`;
