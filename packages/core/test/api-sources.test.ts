import { describe, expect, it } from 'vitest';
import {
  householdCreateSchema,
  householdPatchSchema,
  householdSourceViewSchema,
  householdWriteSchema,
  sourcesResponseSchema,
} from '../src/api.ts';

/**
 * The two scopes of `/api/sources` (D-034's W4 ruling). The contract is where the
 * privacy rule lives: a household device is **not sent the file**, so it cannot show,
 * cache in a browser, or post back what the desk keeps private.
 */
describe('the sources scopes', () => {
  const fullFile = {
    file: 'bbc.json',
    id: 'bbc',
    kind: 'rss',
    label: 'BBC',
    text: '{"watchwords":["iran"],"notes":"the reader\u2019s own words"}',
    issues: [],
    enabled: true,
    state: null,
  };
  const houseFile = {
    file: 'bbc.json',
    id: 'bbc',
    kind: 'rss',
    label: 'BBC',
    url: 'https://bbc.example/news',
    section: null,
    group: null,
    weight: 1,
    enabled: true,
    cadenceMinutes: 20,
    issues: [],
    state: null,
  };

  it('names the knobs on the household view, and no private field on any view', () => {
    const fields = Object.keys(householdSourceViewSchema.shape);
    expect(fields).toEqual([
      'file',
      'id',
      'kind',
      'label',
      'url',
      'section',
      'group',
      'weight',
      'enabled',
      'cadenceMinutes',
      'issues',
      'state',
    ]);
    // The words the reading list is made of. A view that gains one of these is a
    // leak, and this is the line that notices.
    for (const privateField of ['text', 'watchwords', 'blockwords', 'notes', 'headers', 'profile']) {
      expect(fields).not.toContain(privateField);
    }
  });

  it('parses a household answer with no file text and no desk path', () => {
    const parsed = sourcesResponseSchema.parse({ scope: 'household', files: [houseFile], writable: true });
    expect(parsed.scope).toBe('household');
    if (parsed.scope !== 'household') return;
    expect(Object.keys(parsed)).not.toContain('dir');
    expect(Object.keys(parsed.files[0] ?? {})).not.toContain('text');
  });

  it('parses the desk answer with the text and the directory', () => {
    const parsed = sourcesResponseSchema.parse({
      scope: 'full',
      dir: 'C:\\desk\\sources',
      files: [fullFile],
      writable: true,
    });
    expect(parsed.scope).toBe('full');
    if (parsed.scope !== 'full') return;
    expect(parsed.dir).toBe('C:\\desk\\sources');
    expect(parsed.files[0]?.text).toContain('watchwords');
  });

  it('refuses an unknown scope, so a server cannot answer a scope the form does not know', () => {
    expect(sourcesResponseSchema.safeParse({ scope: 'admin', files: [], writable: true }).success).toBe(false);
    expect(sourcesResponseSchema.safeParse({ files: [houseFile], writable: true }).success).toBe(false);
  });

  it('accepts a household write of knobs, and refuses the desk body of file text', () => {
    expect(householdWriteSchema.safeParse({ id: 'bbc', patch: { weight: 2, enabled: false } }).success).toBe(true);
    expect(
      householdWriteSchema.safeParse({ create: { id: 'guardian', label: 'G', url: 'https://x.test/rss', kind: 'rss' } })
        .success,
    ).toBe(true);
    expect(householdWriteSchema.safeParse({ text: '{"id":"bbc"}' }).success).toBe(false);
    expect(householdWriteSchema.safeParse({ id: 'BBC', patch: { weight: 2 } }).success).toBe(false);
  });

  it('treats an empty patch as no request at all, and carries no defaults', () => {
    // The trap this guards: `.partial()` leaves `.default()`s in place, so an
    // unwrapped shape parses a body of only unknown keys into `{ weight: 1, … }` —
    // a write nobody asked for. A patch shape has no defaults, for that reason.
    expect(householdPatchSchema.safeParse({}).success).toBe(false);
    expect(householdPatchSchema.safeParse({ watchwords: ['iran'], notes: 'x' }).success).toBe(false);
    expect(householdPatchSchema.safeParse({ weight: 0 }).success).toBe(true);
  });

  it('adds rss and html from the couch, and refuses json', () => {
    expect(
      householdCreateSchema.safeParse({ id: 'a-feed', label: 'A', url: 'https://x.test/rss', kind: 'rss' }).success,
    ).toBe(true);
    expect(
      householdCreateSchema.safeParse({ id: 'a-page', label: 'A', url: 'https://x.test', kind: 'html' }).success,
    ).toBe(true);
    expect(
      householdCreateSchema.safeParse({ id: 'an-api', label: 'A', url: 'https://x.test/json', kind: 'json' }).success,
    ).toBe(false);
    const created = householdCreateSchema.parse({ id: 'a-feed', label: 'A', url: 'https://x.test/rss', kind: 'rss' });
    expect([created.cadenceMinutes, created.enabled, created.weight]).toEqual([20, true, 1]);
  });
});
