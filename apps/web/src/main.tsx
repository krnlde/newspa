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
};

void start();
