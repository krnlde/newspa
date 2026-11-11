import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devPlugins, isServerMode, serverOptions } from './dev/devModes.ts';

/**
 * The only build step in the project (D-001). The paper is a static bundle:
 * no SSR, no server components, no runtime dependency on a CDN.
 *
 * `tailwindcss` is the CSS pipeline for `newspa-paper/styles/paper.css`: v4's
 * Vite plugin, which reads the theme from CSS (`@theme`) and emits only the
 * utilities the components use. It replaces the hand-written pipeline this
 * project had (D-024), and it is the only CSS tool in the tree.
 *
 * Two dev modes and two root scripts, decided by `dev/devModes.ts` (and pinned by
 * `test/unit/devModes.test.ts`, so the scripts cannot drift from the config):
 *
 *  - `pnpm dev` — seed mode: the API comes from `dev/apiPlugin.ts`, i.e. the state
 *    `pnpm seed` wrote out of the parser fixtures. The paper is visible with no
 *    server running, offline, and the design suite depends on that determinism.
 *  - `pnpm ui` — server mode (`vite --mode server`): `/api` is proxied to the real
 *    process on 8787, so hot reload runs against **live news** (`pnpm server` is
 *    that process). `NEWSPA_SERVER=1 pnpm dev` is the same mode, the older spelling.
 *
 * Both bind loopback on 5173. Serving the paper on the LAN is `pnpm start` with
 * `server.host` in `config.json` (D-034) — a dev server has no business being
 * reachable from a phone.
 *
 * The dev API is a Vite middleware, never part of the bundle.
 */
export default defineConfig(({ mode }) => {
  const againstServer = isServerMode(mode, process.env);
  return {
    plugins: [react(), tailwindcss(), ...devPlugins(againstServer)],
    server: serverOptions(againstServer),
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'esnext',
      // The paper is opened on a train: one predictable file set, no chunk sprawl.
      sourcemap: false,
    },
  };
});
