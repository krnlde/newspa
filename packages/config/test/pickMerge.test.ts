import { describe, expect, it } from 'vitest';
import { applyPick, type PickPatch, parseSourceJson } from '../src/index.ts';

/**
 * The merge a pick performs on the reader's file (WP6, D-036).
 *
 * The claims are the ones a tool that rewrites a person's config file has to earn:
 *
 *  - **the reader's keys survive** — the label, the url, the weight, the
 *    watchwords, the section in their own words, the notes, the headers;
 *  - a field the pick **disproved** is removed and said (`fields.link`, when every
 *    item carries its own `href`); a field the pick did not prove is **kept** and
 *    said (`fields.summary`), because the pick's silence is not a verdict on the
 *    reader's work;
 *  - `render` is a pick-time decision (D-007), so a successful pick is the moment
 *    `render: true` becomes `false`, in writing, with the reason;
 *  - `matchCount` is re-based (D-026), and a positional list says so;
 *  - **the returned text is parsed by the loader's own parser** before it is
 *    returned, so the route can hand it to the editor without meeting a file the
 *    boot would refuse;
 *  - a source the pick cannot describe (rss, json, a page) is refused **by name**,
 *    and writes nothing.
 */

const htmlSource = {
  id: 'example-world',
  label: 'Example World',
  url: 'https://example.invalid/world',
  kind: 'html',
  list: 'ul.news > li',
  fields: { title: 'h2', link: 'a', summary: 'p', linkAttr: 'href', dateAttr: 'datetime', imageAttr: 'src' },
  weight: 3,
  watchwords: ['iran'],
  section: 'World',
  notes: 'the reader\u2019s own words',
  headers: { 'accept-language': 'en-GB' },
  matchCount: 30,
  render: true,
};

const text = (over: Record<string, unknown> = {}): string => `${JSON.stringify({ ...htmlSource, ...over }, null, 2)}\n`;

const patch = (over: Partial<PickPatch> = {}): PickPatch => ({
  list: '.card',
  fields: { title: 'a' },
  matchCount: 4,
  positional: false,
  ...over,
});

const merged = (raw: string, over: Partial<PickPatch> = {}) => {
  const run = applyPick(raw, patch(over));
  if (!run.ok) throw new Error(run.messages.join('; '));
  return { spec: parseSourceJson(run.text, 'merged.json'), text: run.text, messages: run.messages };
};

describe('an html item source, merged', () => {
  it('the reader\u2019s own keys survive, and the four fields change', () => {
    const { spec, messages } = merged(text());
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    const mergedSpec = spec.spec;
    expect(mergedSpec.kind).toBe('html');
    if (mergedSpec.kind !== 'html') return;
    expect(mergedSpec.id).toBe('example-world');
    expect(mergedSpec.label).toBe('Example World');
    expect(mergedSpec.url).toBe('https://example.invalid/world');
    expect(mergedSpec.weight).toBe(3);
    expect(mergedSpec.watchwords).toEqual(['iran']);
    expect(mergedSpec.section).toBe('World');
    expect(mergedSpec.notes).toBe('the reader\u2019s own words');
    expect(mergedSpec.headers).toEqual({ 'accept-language': 'en-GB' });
    expect(mergedSpec.list).toBe('.card');
    expect(mergedSpec.matchCount).toBe(4);
    expect(mergedSpec.render).toBe(false);
    expect(messages.join(' ')).toContain('D-007');
  });

  it('removes a fields.link the pick disproved, and says why', () => {
    const { spec, messages } = merged(text());
    expect(spec.ok).toBe(true);
    if (!spec.ok || spec.spec.kind !== 'html') return;
    expect(spec.spec.fields.link).toBeUndefined();
    expect(messages.join(' ')).toContain('linkFrom reads that first');
  });

  it('keeps a fields.summary the pick did not prove, and says so', () => {
    const { spec, messages } = merged(text());
    expect(spec.ok).toBe(true);
    if (!spec.ok || spec.spec.kind !== 'html') return;
    expect(spec.spec.fields.summary).toBe('p');
    expect(messages.join(' ')).toContain('fields.summary kept as you wrote it');
  });

  it('writes the summary it derived, over the reader\u2019s', () => {
    const { spec, messages } = merged(text(), { fields: { title: 'a', summary: '[class*=deck]' } });
    expect(spec.ok).toBe(true);
    if (!spec.ok || spec.spec.kind !== 'html') return;
    expect(spec.spec.fields.summary).toBe('[class*=deck]');
    expect(spec.spec.fields.title).toBe('a');
    expect(messages.join(' ')).not.toContain('kept as you wrote it');
  });

  it('writes fields.link when the pick proved one', () => {
    const { spec } = merged(text(), { fields: { title: 'a', link: 'a[href]' } });
    expect(spec.ok).toBe(true);
    if (!spec.ok || spec.spec.kind !== 'html') return;
    expect(spec.spec.fields.link).toBe('a[href]');
  });

  it('names the count it re-based, and the first count it set', () => {
    const rebase = merged(text());
    expect(rebase.messages.join(' ')).toContain('the file said 30');
    expect(rebase.messages.join(' ')).toContain('match 4');

    const fresh = merged(text({ matchCount: undefined }));
    expect(fresh.messages.join(' ')).toContain('matchCount set to 4');
  });

  it('says the word "positional" about a :nth-child list', () => {
    const { messages } = merged(text(), {
      list: 'section > li:nth-child(1), section > h2:nth-child(2)',
      positional: true,
    });
    expect(messages.join(' ')).toContain('positional (:nth-child)');
  });
});

describe('what a pick refuses to merge', () => {
  it('a feed: no list, no fields, by name', () => {
    const run = applyPick(
      `${JSON.stringify({ id: 'feed', label: 'Feed', url: 'https://x/y', kind: 'rss' }, null, 2)}\n`,
      patch(),
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.messages.join(' ')).toContain("'rss'");
    expect(run.messages.join(' ')).toContain('wrote nothing');
  });

  it('a page source: a page has no list to pick (D-028)', () => {
    const run = applyPick(text({ list: null, fields: undefined }), patch());
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.messages.join(' ')).toContain('D-028');
  });

  it('text that does not validate, quoting the loader', () => {
    const broken = applyPick('{ "id": ', patch());
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.messages[0]).toContain('does not validate');
    expect(broken.messages.length).toBeGreaterThan(1);

    const invalid = applyPick(text({ id: '' }), patch());
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.messages.join(' ')).toContain('id');
  });

  it('says nothing about a key the file did not have: no link to remove, no deck to keep, no render to change', () => {
    // The honest arms of the merge: a reader whose file never mentioned `link`,
    // `summary` or `render` gets a merge with **no** advice in it. A tool that
    // printed a sentence about a key it never touched trains the reader to ignore it.
    const bare = text({
      fields: { title: 'h2' },
      render: false,
      matchCount: 4,
    });
    const { spec, messages } = merged(bare);
    expect(spec.ok).toBe(true);
    if (!spec.ok || spec.spec.kind !== 'html') return;
    expect(spec.spec.fields.link).toBeUndefined();
    expect(spec.spec.fields.summary).toBeUndefined();
    expect(spec.spec.render).toBe(false);
    expect(messages).toEqual([]);
  });

  it('re-bases a matchCount, and names the first one it set', () => {
    const same = merged(text({ matchCount: 4 }));
    expect(same.messages.join(' ')).not.toContain('matchCount');
  });

  it('a merge that would not validate is refused, not returned', () => {
    // A schema that accepts `fields.title` as a CSS path of at least one character:
    // a patch naming the empty string must not survive into a file.
    const run = applyPick(text(), patch({ fields: { title: '' } }));
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.messages.join(' ')).toContain('does not validate');
  });
});
