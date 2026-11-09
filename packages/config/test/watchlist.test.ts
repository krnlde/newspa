import { describe, expect, it, vi } from 'vitest';
import {
  gatherWatchlist,
  mergeWatchlists,
  parseWatchlist,
  scopeKey,
  serializeWatchlist,
  splitWatchlist,
  WATCHLIST_SCHEMA_VERSION,
  watchlistSchema,
} from '../src/watchlist.ts';

const parseOk = (text: string) => {
  const parsed = parseWatchlist(text);
  if (!parsed.ok) throw new Error(`expected a valid watchlist: ${parsed.messages.join('; ')}`);
  return parsed.watchlist;
};

describe('scopeKey', () => {
  it('names the two scopes distinctly', () => {
    expect(scopeKey('global')).toBe('global');
    expect(scopeKey({ sourceId: 'npr-world' })).toBe('source:npr-world');
  });
});

describe('parseWatchlist', () => {
  it('accepts a real export and fills the defaults the schema promises', () => {
    const watchlist = parseOk(
      JSON.stringify({
        $schema: 'https://example.test/schemas/watchlist.schema.json',
        $schemaVersion: WATCHLIST_SCHEMA_VERSION,
        exportedAt: '2026-11-08T22:41:00.000Z',
        terms: [
          { term: 'transit budget' },
          { term: 'celebrity', kind: 'block' },
          { term: 'cycling', scope: { sourceId: 'city-blog' } },
        ],
        weights: [{ sourceId: 'npr-world', weight: 4 }],
      }),
    );
    expect(watchlist.terms[0]).toEqual({ term: 'transit budget', kind: 'watch', scope: 'global' });
    expect(watchlist.terms[2]?.scope).toEqual({ sourceId: 'city-blog' });
    expect(watchlist.weights).toEqual([{ sourceId: 'npr-world', weight: 4 }]);
  });

  it('accepts a document with nothing in it', () => {
    expect(parseOk('{}').terms).toEqual([]);
    expect(parseOk('{}').$schemaVersion).toBe(WATCHLIST_SCHEMA_VERSION);
  });

  it('reports unparseable JSON as one message', () => {
    const parsed = parseWatchlist('not json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.messages[0]).toContain('not JSON');
  });

  it('refuses an unknown $schemaVersion instead of migrating it', () => {
    const parsed = parseWatchlist(JSON.stringify({ $schemaVersion: 'newspa.watchlist.v0', terms: [] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.messages[0]).toContain('unsupported $schemaVersion "newspa.watchlist.v0"');
    expect(parsed.messages[0]).toContain(WATCHLIST_SCHEMA_VERSION);
  });

  it('labels a document whose root is not an object "(root)"', () => {
    // `[]` parses as JSON, so it reaches the schema, whose single issue has an
    // empty path. The label is what makes the message point at the document.
    const parsed = parseWatchlist('[]');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.messages).toEqual(['(root): Invalid input: expected object, received array']);
  });

  it('reports unparseable text whose throw is not an Error', () => {
    // Same defensive arm as `load.ts` and the same honest cost: `JSON.parse`
    // throws a `SyntaxError`, so a non-`Error` throw can only be fabricated.
    // It is pinned because the contract is "one message, never a crash".
    vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'this throw is not an Error';
    });
    const parsed = parseWatchlist('not json');
    vi.restoreAllMocks();
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.messages).toEqual(['not JSON: unparseable']);
  });

  it('names the offending field of a term and a weight', () => {
    const bad = parseWatchlist(
      JSON.stringify({
        terms: [{ term: 'x'.repeat(90), note: 'y'.repeat(300) }],
        weights: [{ sourceId: 'n', weight: 9 }],
      }),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const joined = bad.messages.join('\n');
    expect(joined).toContain('terms.0.term');
    expect(joined).toContain('terms.0.note');
    expect(joined).toContain('weights.0.weight');
  });

  it('rejects a scope that is neither global nor a sourceId', () => {
    expect(watchlistSchema.safeParse({ terms: [{ term: 'a', scope: { sourceId: 'a' } }] }).success).toBe(false);
    expect(watchlistSchema.safeParse({ terms: [{ term: 'a', scope: 'everything' }] }).success).toBe(false);
  });
});

describe('mergeWatchlists', () => {
  const base = parseOk(JSON.stringify({ terms: [{ term: 'Transit' }, { term: 'celebrity', kind: 'block' }] }));
  const incoming = parseOk(
    JSON.stringify({
      terms: [
        { term: 'transit' },
        { term: 'cycling', scope: { sourceId: 'city-blog' } },
        { term: 'gossip', kind: 'block' },
      ],
      weights: [{ sourceId: 'city-blog', weight: 2 }],
    }),
  );

  it('unions terms, deduped case-insensitively per scope', () => {
    const merged = mergeWatchlists(base, incoming);
    expect(merged.terms.map((term) => term.term)).toEqual(['celebrity', 'gossip', 'transit', 'cycling']);
  });

  it('keeps weights by source, latest wins', () => {
    const merged = mergeWatchlists(
      mergeWatchlists(base, { ...incoming, weights: [{ sourceId: 'city-blog', weight: 2 }] }),
      parseOk(JSON.stringify({ weights: [{ sourceId: 'city-blog', weight: 5 }] })),
    );
    expect(merged.weights).toEqual([{ sourceId: 'city-blog', weight: 5 }]);
  });

  it('sorts merged weights by source id, with the incoming weight winning', () => {
    // The single-weight case above never calls the comparator at all (a
    // one-element array is not sorted), so the ordering rule exports rely on —
    // a stable, diffable export — was untested. A tie inside the comparator is
    // impossible: `weights` is a Map keyed by sourceId.
    const merged = mergeWatchlists(
      parseOk(
        JSON.stringify({
          weights: [
            { sourceId: 'npr-world', weight: 4 },
            { sourceId: 'city-blog', weight: 2 },
          ],
        }),
      ),
      parseOk(
        JSON.stringify({
          weights: [
            { sourceId: 'city-blog', weight: 5 },
            { sourceId: 'bbcsport', weight: 1 },
          ],
        }),
      ),
    );
    expect(merged.weights).toEqual([
      { sourceId: 'bbcsport', weight: 1 },
      { sourceId: 'city-blog', weight: 5 },
      { sourceId: 'npr-world', weight: 4 },
    ]);
  });

  it('orders terms by kind, then scope, then term text', () => {
    // Each `||` in the comparator only runs when the level above ties, so this
    // needs two global watch terms (equal kind, equal scope) to reach the term
    // comparison, and the same term in two scopes to reach the scope one.
    const merged = mergeWatchlists(
      parseOk(JSON.stringify({ terms: [{ term: 'zebra' }, { term: 'apple' }] })),
      parseOk(
        JSON.stringify({
          terms: [
            { term: 'aardvark' },
            { term: 'apple', scope: { sourceId: 'city-blog' } },
            { term: 'zebra', scope: { sourceId: 'city-blog' } },
            { term: 'celebrity', kind: 'block' },
            { term: 'gossip', kind: 'block', scope: { sourceId: 'city-blog' } },
          ],
        }),
      ),
    );
    expect(merged.terms.map((term) => [term.kind, scopeKey(term.scope), term.term])).toEqual([
      ['block', 'global', 'celebrity'],
      ['block', 'source:city-blog', 'gossip'],
      ['watch', 'global', 'aardvark'],
      ['watch', 'global', 'apple'],
      ['watch', 'global', 'zebra'],
      ['watch', 'source:city-blog', 'apple'],
      ['watch', 'source:city-blog', 'zebra'],
    ]);
  });

  it('stamps the merged document so it can be imported again', () => {
    const merged = mergeWatchlists(base, incoming);
    expect(merged.$schemaVersion).toBe(WATCHLIST_SCHEMA_VERSION);
    expect(Number.isNaN(Date.parse(merged.exportedAt ?? ''))).toBe(false);
    expect(mergeWatchlists(merged, merged).terms).toHaveLength(merged.terms.length);
  });
});

describe('gatherWatchlist and splitWatchlist', () => {
  const global = { watchwords: ['transit budget'], blockwords: ['celebrity'] };
  const sources = [
    { id: 'city-blog', weight: 4, watchwords: ['cycling'], blockwords: ['gossip'] },
    { id: 'npr-world', weight: 1, watchwords: [], blockwords: [] },
  ];
  const gathered = gatherWatchlist(global, sources);

  it('collects global and per-source terms, plus weights', () => {
    expect(gathered.terms).toEqual([
      { term: 'celebrity', kind: 'block', scope: 'global' },
      { term: 'gossip', kind: 'block', scope: { sourceId: 'city-blog' } },
      { term: 'transit budget', kind: 'watch', scope: 'global' },
      { term: 'cycling', kind: 'watch', scope: { sourceId: 'city-blog' } },
    ]);
    expect(gathered.weights).toEqual([
      { sourceId: 'city-blog', weight: 4 },
      { sourceId: 'npr-world', weight: 1 },
    ]);
  });

  it('splits back into exactly the two places it lives at runtime', () => {
    const split = splitWatchlist(gathered);
    expect(split.global).toEqual({ watchwords: ['transit budget'], blockwords: ['celebrity'] });
    expect(split.bySource.get('city-blog')).toEqual({ watchwords: ['cycling'], blockwords: ['gossip'], weight: 4 });
    expect(split.bySource.get('npr-world')).toEqual({ watchwords: [], blockwords: [], weight: 1 });
  });

  it('gives a source with only a weight an empty term list', () => {
    const split = splitWatchlist(parseOk(JSON.stringify({ weights: [{ sourceId: 'lonely', weight: 0 }] })));
    expect(split.bySource.get('lonely')).toEqual({ watchwords: [], blockwords: [], weight: 0 });
  });

  it('round-trips gather → split → gather', () => {
    const split = splitWatchlist(gathered);
    const again = gatherWatchlist(split.global, [
      {
        id: 'city-blog',
        weight: split.bySource.get('city-blog')?.weight ?? 1,
        watchwords: split.bySource.get('city-blog')?.watchwords ?? [],
        blockwords: split.bySource.get('city-blog')?.blockwords ?? [],
      },
    ]);
    expect(again.terms.map((term) => term.term).sort()).toEqual(['celebrity', 'cycling', 'gossip', 'transit budget']);
  });
});

describe('serializeWatchlist', () => {
  it('puts the real $schema URL first, and ends with a newline', () => {
    const text = serializeWatchlist(
      gatherWatchlist({ watchwords: ['ai'], blockwords: [] }, []),
      'https://example.test/watchlist.schema.json',
    );
    expect(text.startsWith('{\n  "$schema": "https://example.test/watchlist.schema.json",')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseOk(text).terms[0]?.term).toBe('ai');
  });
});
