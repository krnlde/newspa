import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import 'newspa-paper/styles/paper.css';
import { Onboarding, Paper, SourcesModal, sheetClass } from 'newspa-paper';
import { fetchState, openEvents } from './api.ts';
import { formatFor } from './format.ts';
import { paperLabelsOf, sourcesModalLabelsOf } from './labels.ts';
import { useLocale } from './lib/useLocale.ts';
import { SourcesSection } from './SourcesSection.tsx';
import { useTheme } from './theme.ts';

/**
 * The app: state from `/api/state`, live invalidation from `/api/events`, and the
 * sources editor in a modal above the sheet (WP14). Layout is `newspa-paper`'s;
 * strings and dates come from the locale seam (D-019); the theme is `data-theme`
 * on `<html>`.
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
  const [editing, setEditing] = useState(false);
  const [returnTo, setReturnTo] = useState<Element | null>(null);
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
  const modalLabels = sourcesModalLabelsOf(t);
  const format = formatFor(locale);
  const themeLabel = theme === 'dark' ? t('paper.theme.toLight') : t('paper.theme.toDark');

  if (state.isPending) {
    return (
      <div data-part="sheet" className={sheetClass}>
        <p data-part="summary" className="m-0 py-[0.15rem] text-kicker font-bold tracking-kicker uppercase text-muted">
          {t('paper.loading')}
        </p>
      </div>
    );
  }

  if (state.isError) {
    // The failure state is the onboarding panel with the publisher's words in
    // it: both end in the same reader question, and the panel is the paper's,
    // not the app's (`sheetClass` and `Onboarding` are exported for this).
    return (
      <div data-part="sheet" className={sheetClass}>
        <Onboarding
          copy={{
            title: t('paper.failed'),
            lead: state.error.message,
            steps: [],
            command: t('paper.failedHint'),
          }}
        />
      </div>
    );
  }

  const { masthead, edition, sources } = state.data;
  return (
    <>
      <Paper
        masthead={masthead}
        edition={edition}
        sources={sources}
        labels={labels}
        format={format}
        theme={theme}
        onToggleTheme={toggle}
        themeLabel={themeLabel}
        editor={{
          label: t('sources.open'),
          onOpen: (control: HTMLElement) => {
            // The modal unmounts when it closes, so the browser's own focus return
            // has nothing to return to: remember the pressed control and focus it.
            setReturnTo(control);
            setEditing(true);
          },
        }}
      />
      {/* The editor opens **above** the sheet, not inside it: the sheet is the one
          panel of newsprint, and a form is not news (WP14). It mounts only while it
          is open — so the page carries no hidden form, and the reading list is
          fetched when the reader asks for it (the answer is the reader's files, and
          rule 18 keeps them to a loopback peer, who reads the server's refusal
          sentence here). `<dialog>` gives Esc, the focus trap and the top layer. */}
      {editing ? (
        <SourcesModal
          open
          labels={modalLabels}
          onClose={() => {
            setEditing(false);
            if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
          }}
        >
          <SourcesSection />
        </SourcesModal>
      ) : null}
    </>
  );
};
