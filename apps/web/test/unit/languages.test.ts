import { describe, expect, it } from 'vitest';
import {
  baseLanguage,
  DEFAULT_LANGUAGE,
  detectLanguage,
  htmlDirection,
  isSupportedLanguage,
  LANGUAGE_STORAGE_KEY,
  languagesFromNavigator,
  rememberLanguage,
  SUPPORTED_LANGUAGES,
  storedLanguage,
} from '../../src/i18n/languages.ts';

describe('isSupportedLanguage', () => {
  it('accepts only the catalog', () => {
    for (const language of SUPPORTED_LANGUAGES) expect(isSupportedLanguage(language)).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it('is case-insensitive, because it is fed what `navigator` gives', () => {
    expect(isSupportedLanguage('DE')).toBe(true);
    expect(isSupportedLanguage('EN-GB')).toBe(false);
  });
});

describe('baseLanguage', () => {
  it('takes the subtag out of a BCP 47 tag', () => {
    expect(baseLanguage('de-DE')).toBe('de');
    expect(baseLanguage('en-GB')).toBe('en');
    expect(baseLanguage('fr')).toBe('fr');
    expect(baseLanguage('')).toBe('');
  });
});

describe('languagesFromNavigator', () => {
  it('lists `languages` then `language`, and drops the empty strings', () => {
    expect(languagesFromNavigator({ languages: ['de-DE', 'en'], language: 'fr' })).toEqual(['de-DE', 'en', 'fr']);
    expect(languagesFromNavigator({ languages: ['de', ''], language: '' })).toEqual(['de']);
    expect(languagesFromNavigator({})).toEqual([]);
  });

  it('reads the live browser when no source is given (the production call site)', () => {
    // An explicit `undefined` is the *default parameter*, i.e. "use the browser",
    // not "there is no browser" — so the empty-browser case is `languagesFromNavigator({})`.
    // This is the line `detectLanguage()` uses on a real start.
    const live = languagesFromNavigator();
    expect(Array.isArray(live)).toBe(true);
    expect(live.length).toBeGreaterThan(0);
    expect(detectLanguage()).toBe('en');
  });
});

describe('detectLanguage', () => {
  it('prefers a stored choice over the browser', () => {
    rememberLanguage('de');
    expect(detectLanguage({ languages: ['en-US'], language: 'en-US' })).toBe('de');
    expect(storedLanguage()).toBe('de');
  });

  it('walks the browser list in order and takes the base tag', () => {
    expect(detectLanguage({ languages: ['fr-FR', 'de-AT', 'en-GB'], language: 'fr-FR' })).toBe('de');
  });

  it('uses the single `language` when `languages` is absent', () => {
    expect(detectLanguage({ language: 'de-AT' })).toBe('de');
    expect(detectLanguage({ language: 'zh-Hans' })).toBe(DEFAULT_LANGUAGE);
  });

  it('falls back to the default when nothing matches, and for an empty browser', () => {
    expect(detectLanguage({ languages: ['zh-Hans', 'sw'] })).toBe(DEFAULT_LANGUAGE);
    expect(detectLanguage({})).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('ignores a stored value that is not in the catalog', () => {
    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(storedLanguage()).toBeNull();
    expect(detectLanguage({ languages: ['de-DE'] })).toBe('de');
  });
});

describe('htmlDirection', () => {
  it('is ltr for every language the paper speaks', () => {
    for (const language of SUPPORTED_LANGUAGES) expect(htmlDirection(language)).toBe('ltr');
    expect(htmlDirection('de-AT')).toBe('ltr');
  });

  it('knows the right-left languages it does not yet speak', () => {
    expect(htmlDirection('ar')).toBe('rtl');
    expect(htmlDirection('he-IL')).toBe('rtl');
    expect(htmlDirection('unknown-tag')).toBe('ltr');
  });
});

describe('rememberLanguage', () => {
  it('persists under exactly the key the detector reads', () => {
    rememberLanguage('de');
    expect(globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(LANGUAGE_STORAGE_KEY).toBe('newspa.language');
  });
});
