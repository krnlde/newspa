import type { PluginOption, ServerOptions } from 'vite';
import { devApi } from './apiPlugin.ts';

/**
 * The two dev modes, as a **function of their inputs** rather than as a reading of
 * `process.env` at module load — which is what lets `test/unit/devModes.test.ts` pin
 * the pair of root scripts (`pnpm dev`, `pnpm ui`) with an assertion instead of a
 * sentence.
 *
 * The modes differ in exactly one thing: **who answers `/api`.**
 *
 *  - seed mode — the dev middleware serves `dev/state.json`, written by `pnpm seed`
 *    out of the parser fixtures. No server, no database, no network: the paper is
 *    visible offline, deterministically, which is also what the design suite wants.
 *  - server mode — `/api` is proxied to the real process on 8787, so hot reload runs
 *    against live news with no CORS and no absolute URLs in app code (the app always
 *    calls `/api/*`).
 *
 * `mode` is Vite's `--mode` (what `pnpm ui` passes); the `NEWSPA_SERVER=1` env var is
 * the older spelling and keeps working, because a flag that needs a shell-specific
 * `FOO=1` prefix is not portable to the platform's default script shell.
 */
export const isServerMode = (mode: string | undefined, env: Record<string, string | undefined>): boolean =>
  mode === 'server' || env['NEWSPA_SERVER'] === '1';

/** The dev middleware, in seed mode only: it must never be part of a server-mode run. */
export const devPlugins = (againstServer: boolean): PluginOption[] => (againstServer ? [] : [devApi()]);

/**
 * Vite's dev-server options. The proxy is **present only in server mode** — with
 * `exactOptionalPropertyTypes`, `proxy: undefined` is not the same as no `proxy`, and
 * `ServerOptions` does not accept it.
 *
 * `host` is deliberately absent: a dev server binds loopback. The LAN is the product's
 * bind (`server.host` in `config.json`, D-034), and a build tool's socket next to a
 * `/api/state` that is the reading list is not a thing to put on a network by default.
 *
 * Measured on Windows, and worth knowing before it reads as a broken proxy: Vite 8's
 * default `localhost` bind is **IPv6-only here** — `http://localhost:5173` and
 * `http://[::1]:5173` answer, `http://127.0.0.1:5173` is refused. The proxy target is
 * IPv4 (`127.0.0.1:8787`), which is right for the product's bind: the default is
 * `127.0.0.1` and `0.0.0.0` covers IPv4 loopback. So the dev URL to type is
 * `http://localhost:5173`, and a `127.0.0.1:5173` probe failing is the bind, not the
 * paper.
 */
export const serverOptions = (againstServer: boolean): ServerOptions => {
  const base: ServerOptions = { port: 5173, strictPort: true };
  return againstServer
    ? { ...base, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } }
    : base;
};
