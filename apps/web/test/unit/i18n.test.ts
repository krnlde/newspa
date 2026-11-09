import { describe, expect, it } from 'vitest';
import { applyDocumentLanguage, initI18n, LANGUAGE_STORAGE_KEY, setLanguage } from '../../src/i18n/index.ts';

describe('applyDocumentLanguage', () => {
  it('sets lang and dir together', () => {
    applyDocumentLanguage('de');
    expect(document.documentElement.lang).toBe('de');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('initI18n', () => {
  it('speaks the language it is told, in the document and in `t`', async () => {
    const instance = await initI18n({ language: 'de' });
    expect(instance.language).toBe('de');
    expect(instance.t('nav.sources')).toBe('Quellen');
    expect(document.documentElement.lang).toBe('de');
  });

  it('prefers a stored language over the browser, and ignores an unsupported one', async () => {
    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    const fromStorage = await initI18n();
    expect(fromStorage.language).toBe('de');

    globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    const unsupported = await initI18n({ language: 'fr' });
    expect(unsupported.language).toBe('en');
    expect(unsupported.t('nav.sources')).toBe('Sources');
  });

  it('keeps plural forms resolving through `count`, in both languages', async () => {
    const de = await initI18n({ language: 'de' });
    expect(de.t('story.edits', { count: 1 })).toBe('1 Änderung');
    expect(de.t('story.edits', { count: 4 })).toBe('4 Änderungen');
    const en = await initI18n({ language: 'en' });
    expect(en.t('health.strip', { count: 1 })).toBe('1 source needs attention');
    expect(en.t('health.strip', { count: 2 })).toBe('2 sources need attention');
  });

  it('does not double-escape: React escapes, i18next must not', async () => {
    const instance = await initI18n({ language: 'en' });
    expect(instance.t('story.openStory', { source: `People's Daily` })).toBe(`Open the story at People's Daily`);
  });

  it('translates the section ids core computes, and falls back to core’s label', async () => {
    const instance = await initI18n({ language: 'de' });
    expect(instance.t('section.technology')).toBe('Technik');
    expect(instance.t('section.unknown-section', 'Fallback')).toBe('Fallback');
  });
});

describe('setLanguage', () => {
  it('persists the choice, changes the instance, and moves the document', async () => {
    const instance = await initI18n({ language: 'en' });
    await setLanguage(instance, 'de');
    expect(instance.language).toBe('de');
    expect(instance.t('nav.paper')).toBe('Die Zeitung');
    expect(globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('is the value the next start will detect', async () => {
    const instance = await initI18n({ language: 'en' });
    await setLanguage(instance, 'de');
    const restarted = await initI18n();
    expect(restarted.language).toBe('de');
  });
});
