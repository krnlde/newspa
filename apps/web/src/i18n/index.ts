import i18next, { type i18n as I18nInstance, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  htmlDirection,
  isSupportedLanguage,
  type Language,
  rememberLanguage,
  SUPPORTED_LANGUAGES,
} from './languages.ts';
import { de } from './locales/de.ts';
import { en, type Locale } from './locales/en.ts';

/**
 * i18next, initialised once, synchronously: the resources are in the bundle, so
 * there is no loading state and no suspense. `skipOnLanguageDeactivation` and
 * `bindReact` are left at their defaults; the one setting worth naming is
 * `escapeValue: false`, because React escapes text on its own and double-escaping
 * turns an apostrophe into `&#x27;` on the page.
 */
const resources = { en: { translation: en }, de: { translation: de } } as const satisfies Record<
  Language,
  { translation: Locale }
>;

/** `<html lang>` and `<html dir>` are the browser's typography switches. */
export const applyDocumentLanguage = (language: string): void => {
  const element = globalThis.document?.documentElement;
  if (element === undefined) return;
  element.lang = language;
  element.dir = htmlDirection(language);
};

export const initI18n = async (options: { language?: string | null } = {}): Promise<I18nInstance> => {
  const requested = options.language ?? detectLanguage();
  const language = isSupportedLanguage(requested) ? requested : DEFAULT_LANGUAGE;
  // `init` resolves to the `t` function, not the instance, so the instance is
  // taken from the module — it is the singleton `react-i18next` binds to.
  await i18next.use(initReactI18next).init({
    resources: resources as unknown as Resource,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  applyDocumentLanguage(language);
  // One listener for the whole app: whoever changes the language moves the
  // document, so `lang`, `dir` and the `Intl` adapters can never disagree.
  i18next.on('languageChanged', applyDocumentLanguage);
  return i18next;
};

/** The user's choice, persisted, then applied. Not a fire-and-forget: callers
 * `await` it so a test can assert the rendered language. */
export const setLanguage = (instance: I18nInstance, language: Language): Promise<unknown> => {
  rememberLanguage(language);
  return instance.changeLanguage(language);
};

export { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, type Language, SUPPORTED_LANGUAGES } from './languages.ts';
