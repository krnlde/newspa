/**
 * The languages the paper speaks, and how it picks one.
 *
 * Detection is five lines, not a dependency: `localStorage` (an explicit choice
 * always wins) → `navigator.languages` in order → `en`. A language-detection
 * package adds plugins, query-string and cookie sources, and a cache cookie —
 * none of which a single-user local tool has.
 */

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'newspa.language';

export const isSupportedLanguage = (value: string | null | undefined): value is Language =>
  typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value.toLowerCase());

/** `de-DE` → `de`: i18next namespaces the base tag, and the resources are base tags. */
export const baseLanguage = (tag: string): string => tag.split('-')[0]?.toLowerCase() ?? '';

/**
 * The browser's language signal, as a parameter. It is a **source argument**, not
 * a global read: happy-dom's `navigator.languages` is a getter that cannot be
 * stubbed, and a function that reaches for `globalThis.navigator` can only be
 * tested by editing the browser. The production call site is unchanged.
 */
export interface LanguageSource {
  readonly languages?: readonly string[];
  readonly language?: string;
}

export const languagesFromNavigator = (source: LanguageSource | undefined = globalThis.navigator): string[] => {
  const listed = source?.languages ?? [];
  const single = source?.language === undefined ? [] : [source.language];
  return [...listed, ...single].filter((tag) => typeof tag === 'string' && tag.length > 0);
};

export const storedLanguage = (): Language | null => {
  const value = globalThis.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(value) ? value : null;
};

export const detectLanguage = (source?: LanguageSource): Language => {
  const stored = storedLanguage();
  if (stored !== null) return stored;
  for (const tag of languagesFromNavigator(source)) {
    const base = baseLanguage(tag);
    if (isSupportedLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
};

/**
 * Text direction, from the language, not from a stylesheet: `dir` on `<html>` is
 * what makes quotation marks, ellipses and column order correct. English and
 * German are `ltr`; the map exists so adding Arabic is one entry, not a hunt.
 */
const DIRECTIONS: Readonly<Record<string, 'ltr' | 'rtl'>> = { en: 'ltr', de: 'ltr', ar: 'rtl', fa: 'rtl', he: 'rtl' };

export const htmlDirection = (language: string): 'ltr' | 'rtl' => DIRECTIONS[baseLanguage(language)] ?? 'ltr';

export const rememberLanguage = (language: Language): void => {
  globalThis.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
};
