import { CHALLENGE_MARKERS, looksLikeChallenge } from 'newspa-core';
import type { LeadIn } from './sniff.ts';
import { leadIn } from './sniff.ts';

/**
 * A wall is a **named outcome**, never an empty item list. Core owns the
 * vocabulary (`CHALLENGE_MARKERS` in `core/src/health.ts`, measured there on
 * apnews.com: 403, 5 KB, "Just a moment…"), and core's probe window is 4 000
 * characters. This module adds only the arms core's list does not cover, and
 * only ones with a measured cost: a JavaScript-off page and a cookie wall both
 * answer `200`, so nothing upstream names them.
 */

/** Beyond core's list, with the reason each earns its place. */
export const CHALLENGE_EXTRAS: readonly string[] = [
  // The page rendered nothing and said why: the JS tier, which a raw fetch can
  // never satisfy. `render: true` is the fix, and the note has to say so.
  'javascript must be enabled',
  'please enable javascript',
  // Cookie walls answer 200 and print no article.
  'enable cookies',
  'cookies must be enabled',
  'cookies are required',
  // Bot managers, by the text their interstitial ships.
  'are you a robot',
  'unusual traffic',
  'pardon our interruption',
  'request tycoon',
  'checking the browser',
  'ddos protection',
  'one moment, please',
  // What a login wall says to an anonymous fetch.
  'please log in',
  'please sign in',
  'register to continue',
  'subscription required',
];

/**
 * Core's window is 4 000 characters, and that is the point: the wall is the
 * whole document, so its marker is early. 8 000 covers an inline-script
 * preamble; past that a match is prose in an article, not a wall.
 */
export const CHALLENGE_WINDOW = 8_000;

export interface Challenge {
  readonly marker: string;
  /** Where in the probe the marker was seen. */
  readonly index: number;
  readonly source: 'core' | 'extra';
}

const findIn = (probe: string, markers: readonly string[], source: Challenge['source']): Challenge | null => {
  let best: Challenge | null = null;
  for (const marker of markers) {
    const index = probe.indexOf(marker);
    if (index === -1) continue;
    if (best === null || index < best.index) best = { marker, index, source };
  }
  return best;
};

/**
 * Name the wall, if there is one. Core's vocabulary is the base and the
 * measurement that matters is that a marker is **early**: core looks at the
 * first 4 000 characters because a wall is the whole document, and this file
 * keeps that discipline while adding the arms core's list lacks. The safety net
 * at the end is core's own gate, so a wall core names and this file's window
 * misses (a payload whose lead-in comment is 4 000 characters long) is still a
 * named outcome.
 */
export const challengeOf = (text: string, base: LeadIn = leadIn(text)): Challenge | null => {
  const probe = text.slice(base.from, base.from + CHALLENGE_WINDOW).toLowerCase();
  const core = findIn(probe, CHALLENGE_MARKERS, 'core');
  if (core !== null) return core;
  const extra = findIn(probe, CHALLENGE_EXTRAS, 'extra');
  if (extra !== null) return extra;
  if (looksLikeChallenge(text)) return { marker: CHALLENGE_MARKERS.join(', '), index: 0, source: 'core' };
  return null;
};

/** True when the payload is a wall. Same vocabulary, no marker hunting. */
export const isChallenge = (text: string, base: LeadIn = leadIn(text)): boolean => challengeOf(text, base) !== null;

/**
 * A `<noscript>` block is the JS tier's own admission: the page decided to
 * render nothing because scripting is off, which is what a raw fetch is.
 */
export const noscriptOnly = (text: string): boolean => {
  const lower = text.toLowerCase();
  const open = lower.indexOf('<noscript');
  return open !== -1 && lower.indexOf('</noscript>', open) !== -1;
};
