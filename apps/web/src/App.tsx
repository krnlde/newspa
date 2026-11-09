import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import 'newspa-paper/styles/paper.css';
import { Paper } from 'newspa-paper';
import { fetchState, openEvents } from './api.ts';
import { formatFor } from './format.ts';
import { paperLabelsOf } from './labels.ts';
import { useLocale } from './lib/useLocale.ts';
import { useTheme } from './theme.ts';

/**
 * The app: state from `/api/state`, live invalidation from `/api/events`, and
 * nothing else. Layout is `newspa-paper`'s; strings and dates come from the
 * locale seam (D-019); the theme is `data-theme` on `<html>`.
 *
 * The flash on a pushed item is a DOM attribute, not React state: the paper
 * re-renders from the query refetch a moment later, and a flash that survives a
 * re-render would outstay its 300ms.
 */
const flashLink = (link: string): void => {
  // `a.href` is the browser's normalised form (host lower-cased, default port
  // dropped, dot segments resolved); the event carries the publisher's raw
  // string. Comparing them directly means a push whose URL differs only by
  // normalisation flashes nothing, silently — so normalise both.
  const base = globalThis.location?.href ?? 'http://localhost/';
  let target: string;
  try {
    target = new URL(link, base).href;
  } catch {
    return;
  }
  const story = [...document.querySelectorAll<HTMLElement>('article[data-key]')].find(
    (article) => article.querySelector('a')?.href === target,
  );
  if (story === undefined) return;
  story.dataset['flash'] = 'true';
  globalThis.setTimeout(() => {
    delete story.dataset['flash'];
  }, 400);
};

export const App = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const { theme, toggle } = useTheme();
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ['state'],
    queryFn: ({ signal }) => fetchState(signal),
    // The paper is a cache view of the server (D-016); SSE is the fresh signal
    // and this is the floor for a stream that never fires.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(
    () =>
      openEvents(
        (event) => {
          if (event.type === 'item:new' || event.type === 'item:edited') flashLink(event.link);
          void client.invalidateQueries({ queryKey: ['state'] });
        },
        (message) => {
          console.warn(`an SSE message did not parse: ${message}`);
        },
      ),
    [client],
  );

  const labels = paperLabelsOf(t, locale);
  const format = formatFor(locale);
  const themeLabel = theme === 'dark' ? t('paper.theme.toLight') : t('paper.theme.toDark');

  if (state.isPending) {
    return (
      <div className="paper">
        <p className="masthead__summary">{t('paper.loading')}</p>
      </div>
    );
  }

  if (state.isError) {
    return (
      <div className="paper">
        <section className="onboarding">
          <h2 className="onboarding__title">{t('paper.failed')}</h2>
          <p className="onboarding__lead">{state.error.message}</p>
          <pre className="onboarding__command">{t('paper.failedHint')}</pre>
        </section>
      </div>
    );
  }

  const { masthead, edition, sources } = state.data;
  return (
    <Paper
      masthead={masthead}
      edition={edition}
      sources={sources}
      labels={labels}
      format={format}
      theme={theme}
      onToggleTheme={toggle}
      themeLabel={themeLabel}
    />
  );
};
