import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

/**
 * Every web test starts from a clean, known browser state: no stored language
 * (so `detectLanguage` is deterministic), no theme, and no DOM left by the
 * previous test. `cleanup` is explicit because this project runs vitest without
 * globals, which is exactly the case where @testing-library/react's automatic
 * cleanup does not register — leaving DOM behind makes the next test find two
 * of everything and pass or fail for the wrong reason.
 */
afterEach(cleanup);

beforeEach(() => {
  globalThis.localStorage?.clear();
  const element = globalThis.document?.documentElement;
  if (element !== undefined) {
    element.lang = 'en';
    element.dir = 'ltr';
  }
  for (const key of ['theme', 'newspa.language']) globalThis.localStorage?.removeItem(key);
});
