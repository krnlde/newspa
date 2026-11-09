import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devApi } from './dev/apiPlugin.ts';

/**
 * The only build step in the project (D-001). The paper is a static bundle:
 * no SSR, no server components, no runtime dependency on a CDN.
 *
 * Two dev modes, one flag:
 *
 * - `pnpm dev` (default) serves the API from `dev/apiPlugin.ts` — the state
 *   built by `pnpm seed` out of the parser fixtures. The paper is visible with
 *   no server running.
 * - `NEWSPA_SERVER=1 pnpm dev` proxies `/api` to the real server on 8787, so
 *   dev against live state needs no CORS and no absolute URLs in app code: the
 *   app always calls `/api/*`.
 *
 * The dev API is a Vite middleware, never part of the bundle.
 */
const againstServer = process.env['NEWSPA_SERVER'] === '1';

const server = { port: 5173, strictPort: true };

export default defineConfig({
  plugins: [react(), ...(againstServer ? [] : [devApi()])],
  // `proxy` is present only in server mode: with `exactOptionalPropertyTypes`,
  // `proxy: undefined` is not the same as no `proxy` at all, and ServerOptions
  // does not accept it.
  server: againstServer
    ? { ...server, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } }
    : server,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    // The paper is opened on a train: one predictable file set, no chunk sprawl.
    sourcemap: false,
  },
});
