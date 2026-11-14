import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddSourceResponse } from 'newspa-core';
import { SourcesPanel } from 'newspa-paper';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSourceById, fetchSources, postSourceBody, postSourceText, RefusalError } from './api.ts';
import { HouseholdSources } from './HouseholdSources.tsx';
import { sourcesLabelsOf } from './labels.ts';
import { useLocale } from './lib/useLocale.ts';
import { SOURCE_TEMPLATES } from './sourcesTemplates.ts';
import { usePickJob } from './usePickJob.ts';

/**
 * The sources section: the fetching and mutating shell around `SourcesPanel`.
 *
 * The split is the paper's own rule — `newspa-paper` renders words it is handed,
 * this file owns the wire (D-019, and the boundary test in `packages/paper`).
 * So: `useQuery(['sources'], fetchSources)`, three mutations (desk write, desk
 * removal, household patch), and one job that is not a mutation (the pick, D-036,
 * in `usePickJob.ts`), with the answer's `messages` kept in state, because the
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
 * **The peer's scope decides the form** (D-034, W4): the desk peer gets the panel
 * over file text, and a household peer gets the switches form (`HouseholdSources`),
 * because the household list carries no text at all. A list that reports
 * `writable: false` renders no affordance the server would refuse.
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

  /**
   * The status line: the refusal's lines, or the one sentence a failure has.
   *
   * A landed write also spends the fill (D-036): the box's bytes are the file's truth
   * now, so a fill waiting in state is a text that can only do harm — the next
   * re-render would drop it on top of whatever the reader is typing. A fill for a
   * **different** row is cleared too: the rule "a write ends the pick's draft" is one
   * sentence instead of filename math.
   */
  const stated = (error: Error): void => {
    setLines(error instanceof RefusalError ? error.lines : [error.message]);
  };
  const pick = usePickJob(setLines, stated);
  const afterWrite = (answer: AddSourceResponse): void => {
    setLines(answer.messages);
    pick.spendFill();
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

  /**
   * The household write (D-034, W4): one mutation for both bodies — `{id, patch}` and
   * `{create}` — because the route, the answer shape and the settling are the same.
   * The refusal lands in the same status region: the server's zod lines about the
   * knobs are the reader's fix-list, stated, not swallowed (rule 5).
   */
  const household = useMutation({
    mutationFn: async (body: unknown): Promise<AddSourceResponse> => await landed(postSourceBody(body)),
    onSuccess: (answer) => {
      setLines(answer.messages);
    },
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
  if (list.data.scope === 'household') {
    // The household peer (D-034, W4): the list it was answered is switches, so the
    // form it gets is switches — no editor box exists here, because no file text was
    // ever sent. The lines the server wrote about the last patch ride below.
    return (
      <>
        <HouseholdSources
          files={list.data.files}
          busy={household.isPending}
          onApply={async (id, patch) => {
            // The refusal is already stated (`onError: stated`); swallowing the
            // rejection here keeps it from becoming an unhandled promise in dev.
            await household.mutateAsync({ id, patch }).catch(() => undefined);
          }}
          onAdd={async (create) => {
            await household.mutateAsync({ create }).catch(() => undefined);
          }}
        />
        {lines.length === 0 ? null : (
          <div data-part="sources-status" className="mt-3 text-small text-ink-2">
            {lines.map((line) => (
              <p key={line} className="m-0">
                {line}
              </p>
            ))}
          </div>
        )}
      </>
    );
  }
  const onSave = async (text: string, filename?: string): Promise<void> => {
    await save.mutateAsync({ text, filename });
  };
  const onDelete = async (id: string): Promise<void> => {
    await remove.mutateAsync(id);
  };
  const onPick = async (id: string): Promise<void> => {
    await pick.startPicking(id);
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
      pick={pick.job}
      pickFill={pick.pickFill}
    />
  );
};
