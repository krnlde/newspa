import type { EditionSection } from './api.ts';

/**
 * Where a story prints: the section.
 *
 * Two ways in, in this order of precedence:
 *
 * 1. **The source says so.** A source declares `section: "Iran"`, and that is
 *    the heading — in the reader's own words, verbatim (D-019: a label the user
 *    typed is data, not UI chrome, so it is never translated).
 * 2. **The text says so.** The keyword ladder below routes a story that has no
 *    declared home, which is what makes an archive of 40 sources readable.
 *
 * `(?<![a-z])` on every alternative is not decoration: an unbounded substring
 * pattern routes "Central bank raises rates" to *technology* (ai inside "said")
 * and "Transport committee" to *sport* (sport inside "transport"). Stems are
 * prefix-anchored so `technolog` still matches "technologies"; acronyms are
 * fully bounded, the same rule `score.ts` uses for watchwords.
 */
const SECTIONS_BY_KIND: readonly { readonly pattern: RegExp; readonly id: string; readonly title: string }[] = [
  { pattern: /(?<![a-z])(world|international|foreign)/i, id: 'world', title: 'World' },
  { pattern: /(?<![a-z])(politic|election|congress|senate|parliament|government)/i, id: 'politics', title: 'Politics' },
  { pattern: /(?<![a-z])(business|econom|market|finance|money|trade)/i, id: 'business', title: 'Business' },
  {
    pattern: /(?<![a-z])(tech|technolog|(?<![a-z])ai(?![a-z])|startup|software|gadget|cyber)/i,
    id: 'technology',
    title: 'Technology',
  },
  { pattern: /(?<![a-z])(science|space|climate|health|medical|research)/i, id: 'science', title: 'Science & Health' },
  {
    pattern: /(?<![a-z])(sport|football|soccer|(?<![a-z])nba(?![a-z])|(?<![a-z])nfl(?![a-z])|cricket|tennis)/i,
    id: 'sport',
    title: 'Sport',
  },
  { pattern: /(?<![a-z])(culture|arts|film|music|book|style|travel)/i, id: 'culture', title: 'Culture' },
  { pattern: /(?<![a-z])(opinion|editorial|column|analysis|comment)/i, id: 'opinion', title: 'Opinion' },
];

/** The built-in sections, in ladder order. The picker offers these as suggestions. */
export const SECTION_IDS: readonly string[] = SECTIONS_BY_KIND.map((section) => section.id);

/** Coarse section routing so the paper has a front page, not an inbox. */
export const sectionFor = (text: string, fallbackId = 'top'): EditionSection['id'] => {
  for (const { pattern, id } of SECTIONS_BY_KIND) {
    if (pattern.test(text)) return id;
  }
  return fallbackId;
};

/**
 * The title of a built-in section. A slug the ladder never emits prints as
 * "Top Stories", the catch-all heading of a newspaper: a section heading is
 * never a raw id on the page. (A *declared* section does not come through
 * here — it prints the reader's own words, see `sectionOf`.)
 */
export const sectionTitleFor = (sectionId: string): string => {
  const found = SECTIONS_BY_KIND.find((section) => section.id === sectionId);
  return found?.title ?? 'Top Stories';
};

/**
 * A section's id from the words the reader typed. Ids land in `href="#section-x"`
 * and in map keys, so they are slugs: lowercase ASCII, `-` between words,
 * accents folded away ("Québec" → `quebec`, while the **title** keeps its
 * accents — the id is an address, the title is typography).
 *
 * Two labels that slug to one id are one section by construction: "Iran" and
 * "iran" print together, under the first spelling seen. A label with no ASCII
 * letters at all ("…") has no usable id, so it falls back to `top`.
 */
export const sectionIdFor = (label: string): string => {
  const slug = label
    .normalize('NFKD')
    // U+0300–U+036F, the combining marks NFKD separates from a base letter.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'top';
};

/** The heading of a declared section: the reader's own words are the title. */
export const sectionOf = (label: string): { readonly id: string; readonly title: string } => ({
  id: sectionIdFor(label),
  title: label.trim().length > 0 ? label.trim() : 'Top Stories',
});
