import { describe, expect, it } from 'vitest';
import type { HouseholdPatch, SourceSpec } from '../src/index.ts';
import { applyHouseholdPatch, householdCreateSchema, householdPatchSchema, sourceSchema } from '../src/schema.ts';

/**
 * The household field set (D-034's W4 ruling): the switches a device on the LAN may
 * move, and the wall around what it may not read. A source file is a statement about
 * what a reader cares about (rule 18), so the schema — not the route, not the form —
 * is what keeps `watchwords`, `blockwords`, `notes` and `headers` the desk's.
 */

const authored = {
  id: 'bbc-news',
  label: 'BBC News',
  url: 'https://www.bbc.com/news',
  kind: 'html' as const,
  list: 'section[data-testid="list"] li',
  fields: { title: 'h2', link: 'a' },
  section: 'World',
  weight: 3,
  watchwords: ['iran', 'ceasefire'],
  blockwords: ['lottery'],
  notes: 'the deck selector drifted in August',
  headers: { authorization: 'Bearer a-token-shape' },
};

describe('householdPatchSchema', () => {
  it('takes the knobs, by their own names', () => {
    expect(
      householdPatchSchema.safeParse({ weight: 4, section: 'Iran', enabled: false, cadenceMinutes: 60 }).success,
    ).toBe(true);
  });

  it('strips every private key, and refuses a body that names nothing else', () => {
    // Stripping is the whitelist: a body that carries only the desk's fields asks for
    // no change at all, and saying so beats writing a file nobody asked to write.
    const only = householdPatchSchema.safeParse({ watchwords: ['iran'], notes: 'x', headers: { a: 'b' } });
    expect(only.success).toBe(false);
    const mixed = householdPatchSchema.safeParse({ watchwords: ['iran'], weight: 4 });
    expect(mixed.success && mixed.data).toStrictEqual({ weight: 4 });
  });

  it('keeps the schema’s own ranges, so a knob cannot drift from the file’s', () => {
    expect(householdPatchSchema.safeParse({ weight: 6 }).success).toBe(false);
    expect(householdPatchSchema.safeParse({ cadenceMinutes: 0 }).success).toBe(false);
    expect(householdPatchSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
    expect(householdPatchSchema.safeParse({ label: '' }).success).toBe(false);
  });

  it('reads a null section as "the ladder decides again", which is an unset, not a name', () => {
    expect(householdPatchSchema.safeParse({ section: null }).success).toBe(true);
    const patched: SourceSpec = applyHouseholdPatch(sourceSchema.parse(authored), { section: null });
    expect(patched.section).toBeUndefined();
  });
});

describe('applyHouseholdPatch', () => {
  it('moves a knob and leaves every other byte of the file alone', () => {
    const spec = sourceSchema.parse(authored);
    const patched: SourceSpec = applyHouseholdPatch(spec, { weight: 0, enabled: false } as HouseholdPatch);
    expect([patched.weight, patched.enabled]).toEqual([0, false]);
    // The whole point of the merge being a whitelist: the private fields travel
    // through the write untouched, because the write never saw them.
    expect({ ...patched, weight: spec.weight, enabled: spec.enabled }).toStrictEqual(spec);
  });

  it('refuses a patch that would make the source stop being a source', () => {
    // The patch schema is the boundary; the re-parse is the backstop. A hand-built
    // patch that skips the schema still cannot write a file the boot would refuse.
    const spec = sourceSchema.parse(authored);
    expect(() => applyHouseholdPatch(spec, { url: 'not-a-url' })).toThrow();
  });
});

describe('householdCreateSchema', () => {
  it('adds an rss source with the file’s own defaults', () => {
    const created = householdCreateSchema.safeParse({
      id: 'guardian-uk',
      label: 'Guardian UK',
      url: 'https://theguardian.com/uk',
      kind: 'rss',
    });
    expect(created.success).toBe(true);
    if (created.success === false) return;
    const spec = sourceSchema.parse(created.data);
    expect(spec.kind).toBe('rss');
    if (spec.kind !== 'rss') return;
    expect(spec.maxItems).toBe(60);
    expect(spec.watchwords).toEqual([]);
    expect(spec.notes).toBeUndefined();
  });

  it('adds an html source in page mode, so a version page and a status page are addable', () => {
    // D-028: an `html` source with no `list` is the page as one item. That is the
    // shape of a changelog, a download page, a status page — all sayable by URL.
    const spec = sourceSchema.parse(
      householdCreateSchema.parse({
        id: 'node-downloads',
        label: 'Node.js',
        url: 'https://nodejs.org/en/download',
        kind: 'html',
      }),
    );
    expect(spec.kind).toBe('html');
    if (spec.kind !== 'html') return;
    expect(spec.list).toBeNull();
  });

  it('refuses a json source: a selector contract is authoring, and authoring is the desk’s', () => {
    const json = householdCreateSchema.safeParse({ id: 'api', label: 'API', url: 'https://x.test/data', kind: 'json' });
    expect(json.success).toBe(false);
    // And the full schema refuses the same body, so nothing downstream can invent the
    // `itemsPath` a json source cannot work without.
    expect(sourceSchema.safeParse({ id: 'api', label: 'API', url: 'https://x.test/data', kind: 'json' }).success).toBe(
      false,
    );
  });

  it('refuses an id that is not a filename, because D-011 makes the id the file', () => {
    expect(
      householdCreateSchema.safeParse({ id: 'API One', label: 'x', url: 'https://x.test', kind: 'rss' }).success,
    ).toBe(false);
  });
});
