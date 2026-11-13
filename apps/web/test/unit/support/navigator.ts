/**
 * The navigator, patched and **put back**.
 *
 * The install control's arms are decided by `navigator` (the iOS user agent, the
 * `standalone` flag an installed app answers with), and `Object.defineProperty` is
 * not a mock: `vi.restoreAllMocks()` and `vi.unstubAllGlobals()` do not undo it, so
 * a test that patches `navigator` leaves every later test in the file wearing that
 * browser. Measured on `install.test.tsx`: the arm that sets `standalone = true`
 * made the two arms after it start 'installed', and they failed for a reason no
 * reader could see in the diff.
 *
 * So a patch is recorded the first time a key is touched and restored on
 * `afterEach` — including an accessor (real browsers make these getters), which is
 * why the original **descriptor** is kept and not the value.
 */
const restored = new Map<string, PropertyDescriptor | undefined>();

/** The browser the install control has no event for (D-039's named case), twice over:
 *  the phone's user agent, and the installed-app flag iOS answers with. */
export const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const patchNavigator = (key: string, value: unknown): void => {
  if (!restored.has(key)) restored.set(key, Object.getOwnPropertyDescriptor(globalThis.navigator, key));
  Object.defineProperty(globalThis.navigator, key, { value, configurable: true, writable: true });
};

export const restoreNavigator = (): void => {
  for (const [key, descriptor] of restored) {
    if (descriptor === undefined) {
      delete (globalThis.navigator as unknown as Record<string, unknown>)[key];
    } else {
      Object.defineProperty(globalThis.navigator, key, descriptor);
    }
  }
  restored.clear();
};
