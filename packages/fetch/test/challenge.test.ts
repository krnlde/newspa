import { CHALLENGE_MARKERS } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { CHALLENGE_EXTRAS, CHALLENGE_WINDOW, challengeOf, isChallenge, noscriptOnly } from '../src/challenge.ts';
import { fixture } from './support.ts';

/**
 * A wall is a **named outcome** (rule 5). Core owns the vocabulary; this
 * package adds the arms core's list lacks, and the discipline that makes a
 * marker trustworthy is that it must be **early**: a wall is the whole
 * document, so a marker past the probe window is prose in an article.
 */
describe('challengeOf', () => {
  it('names core’s marker, and the earliest one wins', () => {
    const wall = challengeOf('<title>Just a moment…</title><p>Checking your browser</p>');
    expect(wall).not.toBeNull();
    expect(wall?.marker).toBe('just a moment');
    expect(wall?.source).toBe('core');
    expect(wall?.index).toBe(7);
    const later = challengeOf('<p>Checking your browser</p><p>just a moment</p>');
    expect(later?.marker).toBe('checking your browser');
  });

  it('names the JS tier and the cookie wall, which core’s list does not cover', () => {
    expect(challengeOf('<p>JavaScript must be enabled to read this.</p>')?.source).toBe('extra');
    expect(challengeOf('<p>Please log in to read the archive.</p>')?.marker).toBe('please log in');
    expect(challengeOf('<p>Cookies are required for this page.</p>')?.marker).toBe('cookies are required');
    expect(challengeOf('<title>Pardon Our Interruption</title>')?.marker).toBe('pardon our interruption');
    expect(challengeOf('<p>Register to continue reading.</p>')?.marker).toBe('register to continue');
    expect(CHALLENGE_EXTRAS).toContain('unusual traffic');
  });

  it('reads the document, not its lead-in comment', () => {
    const commented = '<!-- a note from the proxy -->\n<html><body><h1>News</h1></body></html>';
    expect(challengeOf(commented)).toBeNull();
    expect(challengeOf(`<!-- a note -->\n<title>Just a moment…</title>`)?.marker).toBe('just a moment');
  });

  it('stops at the probe window, so an article about captchas is not blocked', () => {
    const article = `${'a'.repeat(CHALLENGE_WINDOW)}<p>Sign in to read the comments.</p>`;
    expect(challengeOf(article)).toBeNull();
    expect(isChallenge(article)).toBe(false);
    const wall = `${'a'.repeat(CHALLENGE_WINDOW)}<p>Pardon our interruption.</p>`;
    expect(challengeOf(wall)).toBeNull();
    expect(CHALLENGE_WINDOW).toBeGreaterThan(4_000);
    expect(CHALLENGE_MARKERS).toContain('captcha');
  });

  it('falls back to core’s own gate, so a wall core names is never lost', () => {
    // Core probes the first 4 000 characters from offset 0 — inside a lead-in
    // comment this file skips — so a miss here is handed to core's gate.
    const padded = `<!-- a proxy note about access denied -->\n<html><body><h1>News</h1></body></html>`;
    expect(challengeOf(padded)?.marker).toBe(CHALLENGE_MARKERS.join(', '));
    expect(challengeOf(padded)?.source).toBe('core');
    expect(challengeOf(padded)?.index).toBe(0);
  });

  it('says nothing about a payload with no wall', () => {
    expect(challengeOf('')).toBeNull();
    expect(challengeOf('<article><h2>Headline</h2><p>News.</p></article>')).toBeNull();
    expect(isChallenge('')).toBe(false);
  });

  it('names the walls the fixtures captured', () => {
    expect(challengeOf(fixture('challenge-cloudflare.html'))?.marker).toBe('just a moment');
    expect(challengeOf(fixture('challenge-noscript.html'))?.marker).toBe('enable javascript');
    expect(challengeOf(fixture('login-wall.html'))?.marker).toBe('subscribe to continue');
    expect(challengeOf(fixture('plain-text.txt'))).toBeNull();
    expect(challengeOf(fixture('html-card-list.html'))).toBeNull();
  });
});

describe('noscriptOnly', () => {
  it('names the JS tier’s own admission', () => {
    expect(noscriptOnly('<div id="root"></div><noscript>Enable JavaScript.</noscript>')).toBe(true);
    expect(noscriptOnly('<noscript>Unclosed')).toBe(false);
    expect(noscriptOnly('<article><p>News</p></article>')).toBe(false);
  });
});
