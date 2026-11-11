import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddSourceResponse, PickStatusResponse } from 'newspa-core';
import type { PickFill, PickJob } from 'newspa-paper';
import { SourcesPanel } from 'newspa-paper';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSourceById, fetchSources, pickStatus, postSourceText, RefusalError, startPick } from './api.ts';
import { sourcesLabelsOf } from './labels.ts';
import { useLocale } from './lib/useLocale.ts';
import { SOURCE_TEMPLATES } from './sourcesTemplates.ts';

/**
 * The sources section: the fetching and mutating shell around `SourcesPanel`.
 *
 * The split is the paper's own rule — `newspa-paper` renders words it is handed,
 * this file owns the wire (D-019, and the boundary test in `packages/paper`).
 * So: `useQuery(['sources'], fetchSources)`, two mutations, one job that is not a
 * mutation (the pick, D-036), and the answer's `messages` kept in state, because the
 * last thing the server said is the fact the reader needs and it is not in the list.
 *
 * **A write settles two queries.** The file is the reading list, and a successful
 * write upserts the source's row (`sourcesApi.ts`), so the paper's own news changes
 * with it: `['sources']` for the panel, `['state']` for the edition. A refusal
 * settles them too — a refetch that costs one read of a directory is cheaper than a
 * rule about which answers change what, and a removal that 404s usually means the
 * page's list is the thing that was stale.
 *
 * **A refusal rejects the mutation** (`RefusalError`), because the panel's editor is
 * the half that must know: it keeps the box open with the reader's bytes in it and
 * prints the loader's lines beside them. Losing typed JSON on a refused write is a
 * loss the page can see coming.
 *
 * The reading list is loopback-only for **every verb** (rule 18, D-034), so a peer on
 * a phone is refused the read and sees the server's own sentence, stated; a list that
 * reports `writable: false` renders no affordance the server would refuse.
 */

/** A write: the bytes, and the file they came from (a skeleton has none). */
interface WriteInput {
  readonly text: string;
  readonly filename: string | undefined;
}

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The pick job (WP6, D-036), which this shell owns because the wire is the shell's.
 *
 * `POST /api/pick` opens a **real Edge window on the machine that runs the server**
 * and answers at once — a request that waits for a cursor dies in a proxy — so the
 * reader's click arrives later, through `GET /api/pick`. Hence the poll: ask every
 * `PICK_POLL_MS` while the report says `running`, and stop at `picked`, at `failed`,
 * when a request errors, and when the modal unmounts (D-035 unmounts the overlay, and
 * a poll that outlives it is a timer spinning at a component that is gone).
 *
 * **A landed pick fills; it never saves.** The report's `text` goes to the open
 * editor as `pickFill`, and SAVE stays the reader's act, through the one validated
 * write path: a click that rewrote a file would make D-011's truth a mouse's side
 * effect. A `failed` report's `sentence` and `messages` go to the panel's status
 * lines — the same region the save and delete answers use — in the server's own
 * words about its own browser, untranslated (D-019, rule 5).
 */
const PICK_POLL_MS = 1_500;

/** What a report prints: a failure leads with its sentence, a pick with what the merge did. */
const reportOf = (answer: PickStatusResponse): readonly string[] =>
  (answer.state === 'failed' ? [answer.sentence, ...answer.messages] : answer.messages).filter(
    (line) => line.length > 0,
  );

/** The status region takes an `Error`, and the pick's refusals are always one (`RefusalError`). */
const asError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(wordsOf(cause)));

export const SourcesSection = () => {
  const { t } = useTranslation();
  const locale = useLocale();
  const client = useQueryClient();
  const labels = sourcesLabelsOf(t, locale);
  const [lines, setLines] = useState<readonly string[]>([]);
  const list = useQuery({
    queryKey: ['sources'],
    queryFn: ({ signal }) => fetchSources(signal),
  });

  /**
   * A refusal is a failed act, so the mutation rejects with it.
   *
   * Two answers, one direction: the panel's editor keeps the box open with the
   * reader's bytes in it when the write is refused (`SourceEditor.tsx`), and the
   * lines are the loader's own words about the file - the reader's fix-list, which
   * has to be on the page at the moment they are told the write did not land.
   */
  const landed = async (answer: Promise<AddSourceResponse>): Promise<AddSourceResponse> => {
    const at = await answer;
    if (at.ok === false) throw new RefusalError(at.messages);
    return at;
  };

  const afterWrite = (answer: AddSourceResponse): void => {
    setLines(answer.messages);
    /**
     * A landed write spends the fill (D-036). The box's bytes are the file's truth
     * now, so a fill waiting in state is a text that can only do harm: the next
     * re-render would drop it on top of whatever the reader is typing. A fill for a
     * **different** row is cleared too — the worst case is a pick to redo, and the
     * rule "a write ends the pick's draft" is one sentence instead of filename math.
     */
    setPickFill(undefined);
  };

  /**
   * Both queries, whatever the answer was: a write that landed changed the file and
   * the row, and a refusal of a removal usually means the file is not where the page
   * thinks it is. One refetch of a directory is cheaper than a rule about which
   * answers change what.
   */
  const refetch = (): void => {
    void client.invalidateQueries({ queryKey: ['sources'] });
    void client.invalidateQueries({ queryKey: ['state'] });
  };

  /** The status line: the refusal's lines, or the one sentence a failure has. */
  const stated = (error: Error): void => {
    setLines(error instanceof RefusalError ? error.lines : [error.message]);
  };

  /**
   * The pick's two pieces of state, **keyed by source id**: the panel can have two
   * editors open, and a running label or a fill that lands in both speaks for a pick
   * the reader never started (D-036). `pickFill` also carries a **stamp**, not a
   * time: the same text must be able to fill twice (the reader picks, edits, picks
   * again), and the clock belongs to the app, never to the paper (D-019, rule 4).
   */
  const [job, setJob] = useState<PickJob | undefined>(undefined);
  const [pickFill, setPickFill] = useState<PickFill | undefined>(undefined);
  const fills = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The modal's lifetime (D-035): closing it unmounts this component, and a poll
   * that outlives the component is a timer asking a page that has gone away. */
  const alive = useRef(true);

  /**
   * `alive` is the modal's lifetime, and the effect is written as setup **and**
   * teardown: StrictMode invokes an effect twice, so an un-armed setup arm would
   * leave the poll dead for the rest of the modal's life after the first simulated
   * unmount. The teardown clears the pending ask, which is the only timer this
   * component owns.
   */
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
    };
  }, []);

  /** What a report leaves on the page: the job, its lines, and the text to fill. */
  const settlePick = (id: string, answer: PickStatusResponse): void => {
    setJob({ id, state: answer.state });
    const lines = reportOf(answer);
    // A running report has no lines of its own, and `running` is on the control: the
    // last thing the server said stays in the region rather than being blanked.
    if (lines.length > 0) setLines(lines);
    if (answer.state === 'picked' && answer.text !== null) {
      fills.current += 1;
      setPickFill({ id, text: answer.text, at: String(fills.current) });
    }
  };

  /** One ask. `timer.current` is cleared first: a fired timer is not a pending one. */
  const reportPick = async (id: string): Promise<void> => {
    timer.current = null;
    let answer: PickStatusResponse;
    try {
      answer = await pickStatus(id);
    } catch (cause) {
      // An errored request ends the poll and is stated, never retried in the dark:
      // a 404 here means the process that ran the pick is not the one answering, and
      // a page that kept asking would be rule 5's silent zero with a spinner on it.
      if (!alive.current) return;
      setJob({ id, state: 'failed' });
      stated(asError(cause));
      return;
    }
    if (!alive.current) return;
    settlePick(id, answer);
    if (answer.state === 'running') pollPick(id);
  };

  const pollPick = (id: string): void => {
    timer.current = globalThis.setTimeout(() => {
      void reportPick(id);
    }, PICK_POLL_MS);
  };

  /**
   * The pick, started. A refusal is stated in the status region **and rethrown**, so
   * the editor states it beside the box the reader is looking at — the shape a
   * refused save already has — and the job falls back to `failed`, because the
   * server refused a window, it did not open one.
   */
  const startPicking = async (id: string): Promise<void> => {
    setJob({ id, state: 'running' });
    let answer: PickStatusResponse;
    try {
      answer = await startPick(id);
    } catch (cause) {
      setJob({ id, state: 'failed' });
      stated(asError(cause));
      throw cause;
    }
    settlePick(id, answer);
    // The window is open, so the report is asked for. `POST` answers `running` and
    // nothing else, so there is no arm here for a state a start cannot report: one
    // ask, and the answer says `running`, `picked` or `failed`.
    pollPick(id);
  };

  const save = useMutation({
    mutationFn: async (input: WriteInput): Promise<AddSourceResponse> =>
      await landed(postSourceText(input.text, input.filename)),
    onSuccess: afterWrite,
    onError: stated,
    onSettled: refetch,
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<AddSourceResponse> => await landed(deleteSourceById(id)),
    onSuccess: afterWrite,
    onError: stated,
    onSettled: refetch,
  });

  if (list.isPending) {
    return (
      <p data-part="sources-status" className="m-0 text-kicker font-bold tracking-kicker uppercase text-muted">
        {t('sources.loading')}
      </p>
    );
  }

  if (list.isError) {
    // Stated, not swallowed: the panel is where a broken source gets fixed, so a
    // list that did not load has to say what the server said (rule 5). No `panel`
    // class: the modal is the box, and a ringed, dotted box inside it is two boxes
    // (the screenshot that found this showed the dot grid inside the dialog).
    return (
      <section data-part="sources" className="text-small">
        <p data-part="sources-status" className="m-0 text-ink-2">
          {`${t('sources.failed')} ${wordsOf(list.error)}`}
        </p>
      </section>
    );
  }

  const writable = list.data.writable;
  const onSave = async (text: string, filename?: string): Promise<void> => {
    await save.mutateAsync({ text, filename });
  };
  const onDelete = async (id: string): Promise<void> => {
    await remove.mutateAsync(id);
  };
  const onPick = async (id: string): Promise<void> => {
    await startPicking(id);
  };

  return (
    <SourcesPanel
      sources={list.data.files}
      dir={list.data.dir}
      writable={writable}
      labels={labels}
      templates={SOURCE_TEMPLATES}
      messages={lines}
      onSave={writable ? onSave : undefined}
      onDelete={writable ? onDelete : undefined}
      onPick={writable ? onPick : undefined}
      pick={job}
      pickFill={pickFill}
    />
  );
};
