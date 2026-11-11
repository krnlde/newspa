import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddSourceResponse } from 'newspa-core';
import { SourcesPanel } from 'newspa-paper';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSourceById, fetchSources, postSourceText, RefusalError } from './api.ts';
import { sourcesLabelsOf } from './labels.ts';
import { useLocale } from './lib/useLocale.ts';
import { SOURCE_TEMPLATES } from './sourcesTemplates.ts';

/**
 * The sources section: the fetching and mutating shell around `SourcesPanel`.
 *
 * The split is the paper's own rule — `newspa-paper` renders words it is handed,
 * this file owns the wire (D-019, and the boundary test in `packages/paper`).
 * So: `useQuery(['sources'], fetchSources)`, two mutations, and the answer's
 * `messages` kept in state, because the last thing the server said is the fact
 * the reader needs and it is not in the list.
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
    />
  );
};
