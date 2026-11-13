import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initI18n } from './i18n/index.ts';

/**
 * The web shell.
 *
 * i18next is initialised **before** the first render: the resources are in the
 * bundle, so a render that starts before `init` would paint keys
 * (`paper.loading`) and then repaint — a flash of curly braces on a page that
 * is supposed to look like print.
 *
 * The `QueryClient` lives here, at the top: the paper is one cache view of the
 * server (D-016), and `refetchOnWindowFocus` is the honest staleness policy for
 * a page a reader leaves open for an hour.
 */
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const start = async (): Promise<void> => {
  await initI18n();
  const root = document.getElementById('root');
  if (root === null) throw new Error('the document has no #root');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
  registerWorker();
};

/**
 * The worker is registered by the **built app only** (WP16, D-039). A dev server
 * that installs one is a development trap: `pnpm dev` answers from a fixture seed
 * and `pnpm ui` proxies live news, and a worker caching either leaves a reader
 * working on answers that are minutes old with nothing on the page saying so.
 * `import.meta.env.PROD` is the build's own fact, so the rule costs no config knob.
 *
 * A secure context is required and one is what the paper runs on: loopback, or
 * WP17's TLS on the LAN address. A refusal is **printed** (rule 5): a page that
 * silently has no worker is a page whose offline promise was never made, and the
 * reader finds out on a train. Where registration is impossible by design — an
 * e-ink browser with no service worker, D-039's kiosk case — the paper keeps
 * working as a page, which is the fallback that decision chose.
 */
const registerWorker = (): void => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((cause: unknown) => {
    console.warn(`the service worker did not register: ${cause instanceof Error ? cause.message : String(cause)}`);
  });
};

void start();
