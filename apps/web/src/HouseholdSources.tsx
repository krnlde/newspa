import type { HouseholdSourceView } from 'newspa-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The household switches (D-034, W4): the form a device on the LAN gets
 * from `/api/sources`. It is built entirely from `householdSourceViewSchema`'s fields,
 * which is the point — the peer was **never sent** the file text, so this form cannot
 * show, cache, or post back the `watchwords`, `notes` and selectors the desk keeps.
 *
 * The controls are native (`checkbox`, `input`, `select`) because the house rules
 * already say so: the schema owns the ranges, so the form mirrors them and the server
 * re-checks every one. **Apply sends only what moved**: an untouched knob is absent
 * from the patch, which is what keeps "change nothing" from writing a file.
 *
 * The paper owns the sheet; this is chrome inside the modal (D-035), so it borrows
 * the sheet's vocabulary — hairlines, small text, one rule per row — and adds no box,
 * no shadow, no card.
 */

/** The knobs a row can carry; `null` unsets, absent says nothing (mirrors `applyHouseholdPatch`). */
interface Knobs {
  readonly section: string;
  readonly weight: string;
  readonly cadenceMinutes: string;
  readonly enabled: boolean;
}

const draftOf = (file: HouseholdSourceView): Knobs => ({
  section: file.section ?? '',
  weight: String(file.weight ?? 1),
  cadenceMinutes: String(file.cadenceMinutes ?? 20),
  enabled: file.enabled,
});

/** The patch between the loaded view and the draft: only what moved, `''` section means unset. */
type KnobValue = string | number | boolean | null;

const patchOf = (file: HouseholdSourceView, draft: Knobs): Record<string, KnobValue> => {
  const patch: Record<string, KnobValue> = {};
  if (draft.section !== (file.section ?? ''))
    patch['section'] = draft.section.trim() === '' ? null : draft.section.trim();
  if (draft.weight !== String(file.weight ?? 1)) patch['weight'] = Number(draft.weight);
  if (draft.cadenceMinutes !== String(file.cadenceMinutes ?? 20))
    patch['cadenceMinutes'] = Number(draft.cadenceMinutes);
  if (draft.enabled !== file.enabled) patch['enabled'] = draft.enabled;
  return patch;
};

/** The id the file will get: the label, in the shape D-011 demands of a filename. */
const slugOf = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const FIELD = 'text-kicker font-bold tracking-kicker uppercase text-muted';

const INPUT = 'm-0 bg-transparent border border-b-[length:var(--hair)] border-rule rounded-none text-small text-ink';

export const HouseholdSources = ({
  files,
  onApply,
  onAdd,
  busy,
}: {
  readonly files: readonly HouseholdSourceView[];
  readonly onApply: (id: string, patch: Record<string, KnobValue>) => Promise<void>;
  readonly onAdd: (create: Record<string, unknown>) => Promise<void>;
  readonly busy: boolean;
}) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, Knobs>>({});
  const draftFor = (file: HouseholdSourceView): Knobs => drafts[file.file] ?? draftOf(file);

  const setDraft = (file: HouseholdSourceView, patch: Partial<Knobs>): void => {
    setDrafts((old) => ({ ...old, [file.file]: { ...draftFor(file), ...patch } }));
  };

  const [adding, setAdding] = useState({ label: '', url: '', kind: 'rss' });

  return (
    <section data-part="sources" className="text-small">
      <p data-part="household-preamble" className="mt-0 mb-3 italic text-ink-2">
        {t('sources.household.preamble')}
      </p>
      <ul data-part="household-rows" className="m-0 p-0 list-none">
        {files.map((file) => {
          const draft = draftFor(file);
          const patch = patchOf(file, draft);
          const id = file.id;
          return (
            <li
              key={file.file}
              data-part="household-row"
              data-file={file.file}
              className="py-[0.6rem] border-t border-t-[length:var(--hair)] border-t-rule first:border-t-0 first:pt-0"
            >
              <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                <b className="text-deck">{file.label ?? file.file}</b>
                <span className={FIELD}>{file.kind ?? '?'}</span>
                {id === null ? null : (
                  <span data-part="household-state" className={FIELD}>
                    {file.state ?? t('sources.noState')}
                  </span>
                )}
              </p>
              {id === null ? (
                // A file that does not parse has no switches to move: its knobs are
                // unknown, and its issues are the reader's fix-list (rule 5).
                <p data-part="issues" className="mt-1 mb-0 text-ink-2">
                  {file.issues.join(' · ')}
                </p>
              ) : (
                <>
                  {file.issues.length > 0 ? (
                    <p data-part="issues" className="mt-1 mb-0 text-ink-2">
                      {file.issues.join(' · ')}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                    <label className="flex items-baseline gap-1">
                      <input
                        type="checkbox"
                        className="m-0"
                        checked={draft.enabled}
                        onChange={(event) => setDraft(file, { enabled: event.target.checked })}
                      />
                      <span className={FIELD}>{t('sources.household.polling')}</span>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={FIELD}>{t('sources.household.section')}</span>
                      <input
                        type="text"
                        className={INPUT}
                        value={draft.section}
                        placeholder={t('sources.household.sectionPlaceholder')}
                        onChange={(event) => setDraft(file, { section: event.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={FIELD}>{t('sources.household.weight')}</span>
                      <select
                        className={INPUT}
                        value={draft.weight}
                        onChange={(event) => setDraft(file, { weight: event.target.value })}
                      >
                        {[0, 1, 2, 3, 4, 5].map((weight) => (
                          <option key={weight} value={weight}>
                            {weight}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={FIELD}>{t('sources.household.cadence')}</span>
                      <input
                        className={INPUT}
                        type="number"
                        min={1}
                        max={43_200}
                        value={draft.cadenceMinutes}
                        onChange={(event) => setDraft(file, { cadenceMinutes: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      data-part="household-apply"
                      disabled={busy || Object.keys(patch).length === 0}
                      onClick={() => void onApply(id, patch)}
                      className="text-kicker font-bold tracking-kicker uppercase border border-b-[length:var(--hair)] border-rule bg-transparent px-2 py-1 disabled:text-muted"
                    >
                      {busy ? t('sources.household.applying') : t('sources.household.apply')}
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <form
        data-part="household-add"
        className="mt-3 pt-2 border-t border-t-[length:var(--hair)] border-t-rule flex flex-wrap items-end gap-x-3 gap-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onAdd({
            id: slugOf(adding.label),
            label: adding.label.trim(),
            url: adding.url.trim(),
            kind: adding.kind,
          });
        }}
      >
        <p className="w-full m-0 text-kicker font-bold tracking-kicker uppercase">{t('sources.household.addTitle')}</p>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>{t('sources.household.label')}</span>
          <input
            type="text"
            className={INPUT}
            value={adding.label}
            required
            onChange={(event) => setAdding((old) => ({ ...old, label: event.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>{t('sources.household.url')}</span>
          <input
            className={INPUT}
            type="url"
            required
            placeholder="https://example.test/feed"
            value={adding.url}
            onChange={(event) => setAdding((old) => ({ ...old, url: event.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>{t('sources.household.kind')}</span>
          <select
            className={INPUT}
            value={adding.kind}
            onChange={(event) => setAdding((old) => ({ ...old, kind: event.target.value }))}
          >
            <option value="rss">RSS</option>
            <option value="html">HTML</option>
          </select>
        </label>
        <button
          type="submit"
          data-part="household-add-submit"
          disabled={busy}
          className="text-kicker font-bold tracking-kicker uppercase border border-b-[length:var(--hair)] border-rule bg-transparent px-2 py-1 disabled:text-muted"
        >
          {busy ? t('sources.household.adding') : t('sources.household.add')}
        </button>
      </form>
    </section>
  );
};
