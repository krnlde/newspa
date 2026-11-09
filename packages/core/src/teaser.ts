import { normalizeText } from './normalize.ts';

/**
 * The paper is an index, not a mirror (docs/decisions-tooling.md D-017).
 *
 * A story in the paper is a **teaser**: headline plus a paragraph, and the
 * headline links to the source in a new tab. Three reasons, in order of weight:
 *
 * 1. The full text is never sent to the browser. `ItemView` in `api.ts` has no
 *    `body` field at all, so the paper cannot render an article even if a
 *    component is written carelessly. The test on the wire schema asserts it.
 * 2. Clicking through is the point: the source gets the reader, the traffic,
 *    and the ads. A local full-text mirror is a copying problem and a worse
 *    reading experience than the publisher's own page.
 * 3. Event-loop budget. Storing and diffing 40 full articles per cycle is
 *    synchronous work on the loop that also runs the scheduler; a teaser is
 *    bounded, so the DB stays small and the diff stays cheap.
 *
 * The scraped `body` is kept, capped at `BODY_MAX_CHARS`, for stealth-edit
 * detection and scoring only — it is the evidence, not the content.
 */

/** Cap on stored body text: enough to notice a rewrite, far below an article. */
export const BODY_MAX_CHARS = 1_200;

/** Teaser length: roughly the first paragraph, which is what print shows. */
export const TEASER_MAX_CHARS = 240;

/** Truncate at a word boundary and mark the cut. Never mid-word, never mid-sentence-word. */
export const truncate = (value: string, maxChars: number): string => {
  const text = normalizeText(value);
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars + 1);
  const boundary = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  if (boundary >= maxChars * 0.5) return normalizeText(slice.slice(0, boundary + 1));
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.5 ? slice.slice(0, lastSpace) : slice.slice(0, maxChars);
  return `${normalizeText(cut)}…`;
};

export const capBody = (value: string): string => truncate(value, BODY_MAX_CHARS);

/**
 * First paragraph of a body. Paragraphs are blank-line separated in RSS
 * `content:encoded` and in most HTML decks; a single newline is a soft break
 * inside one paragraph, so it is not a split.
 */
export const firstParagraph = (body: string): string => {
  const parts = body.split(/\r?\n\s*\r?\n/);
  for (const part of parts) {
    const text = normalizeText(part);
    if (text.length >= 40) return text;
    if (part === parts[parts.length - 1] && text.length > 0) return text;
  }
  return '';
};

export interface TeaserInput {
  readonly summary: string | null;
  readonly body: string;
}

/**
 * The teaser, in priority order: the deck/summary the publisher wrote, then the
 * first paragraph of whatever body text the source exposed. Empty string means
 * "headline only" — which is a legitimate newspaper item, not a failure.
 */
export const teaserFor = (input: TeaserInput, maxChars = TEASER_MAX_CHARS): string => {
  const summary = input.summary === null ? '' : normalizeText(input.summary);
  const chosen = summary.length > 0 ? summary : firstParagraph(input.body);
  return truncate(chosen, maxChars);
};

const BOILERPLATE: readonly RegExp[] = [
  // `reading` is in the middle because the commonest prompt is "Continue
  // reading the story" — the publisher's own continue-reading line, which is a
  // paywall cue, not a deck.
  /^\s*(read|continue|view|open)\s+(reading\s+)?(the\s+)?(full\s+)?(story|article|more)/i,
  /^\s*(continue|keep)\s+reading\b/i,
  /^\s*(click|tap)\s+here\b/i,
  /^\s*(sign in|log in|subscribe)\s+to\b/i,
];

/** True when a teaser is only a paywall/continue-reading prompt: drop it. */
export const isBoilerplateTeaser = (value: string): boolean =>
  BOILERPLATE.some((pattern) => pattern.test(value)) || value.trim().length < 24;
