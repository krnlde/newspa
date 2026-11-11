/**
 * The dev-mode decision, as a unit — the pair of root scripts (`pnpm dev`,
 * `pnpm ui`) is only honest if the mode each one asks for is asserted, not narrated.
 *
 * The stakes are the LAN rule (D-034): the mode that proxies `/api` to the real
 * process is the one that shows **live news**, and neither dev mode may bind past
 * loopback, because a dev server next to a `/api/state` that is the reading list is
 * not a thing to put on a household network by default.
 */
import { describe, expect, it } from 'vitest';
import { devPlugins, isServerMode, serverOptions } from '../../dev/devModes.ts';

describe('isServerMode', () => {
  it('is Vite’s `--mode server`, which is what `pnpm ui` passes', () => {
    expect(isServerMode('server', {})).toBe(true);
    expect(isServerMode('development', {})).toBe(false);
    expect(isServerMode(undefined, {})).toBe(false);
  });

  it('is the older env spelling too, so a shell-history command keeps working', () => {
    expect(isServerMode('development', { NEWSPA_SERVER: '1' })).toBe(true);
    expect(isServerMode('development', { NEWSPA_SERVER: '0' })).toBe(false);
    expect(isServerMode('development', {})).toBe(false);
  });
});

describe('the middleware and the proxy are mutually exclusive', () => {
  it('seed mode installs the dev API and no proxy', () => {
    expect(devPlugins(false)).toHaveLength(1);
    const options = serverOptions(false);
    expect('proxy' in options).toBe(false);
    expect(options.port).toBe(5173);
    expect(options.strictPort).toBe(true);
  });

  it('server mode installs no middleware and proxies `/api` to 8787', () => {
    expect(devPlugins(true)).toEqual([]);
    const options = serverOptions(true);
    expect(options.proxy).toEqual({ '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } });
  });

  it('neither mode names a host: a dev server binds loopback, the LAN is `pnpm start`', () => {
    for (const againstServer of [true, false]) {
      const options = serverOptions(againstServer);
      expect('host' in options, String(againstServer)).toBe(false);
    }
  });
});
