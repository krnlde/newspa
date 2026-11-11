import { parseSourceJson } from './load.ts';
import type { HtmlFields, HtmlItemSource, SourceSpec } from './schema.ts';

/**
 * The merge a pick performs (WP6, D-036): the derived selectors, into the reader's
 * own file, in text the loader will accept.
 *
 * The file is the truth (D-011), and the reader wrote most of it — the `id`, the
 * `label`, the `url`, the weight, the watchwords, the section in their own words,
 * the notes, the headers. A pick changes **four** things and says each one out
 * loud: `list`, the fields it proved, `matchCount` (D-026's rot baseline, re-based
 * by a re-pick), and `render`.
 *
 * Three rules make the merge safe to run on a file the reader cares about:
 *
 *  - **`fields.link` is replaced, including by absence.** When the pick proved that
 *    every item carries its own `href`, a `fields.link` naming a descendant anchor
 *    is a field that reads empty — so it goes, with a message. `fields.summary` is
 *    **kept** when the pick derived none: the pick's silence is "no deck resolved
 *    on every item", not "the reader's deck is wrong", and it is said.
 *  - **`render` is a pick-time decision (D-007), and this is the pick.** The
 *    derivation proved the selectors on the bytes the poller fetches, so
 *    `render: false` is the honest value, and the message records that the file
 *    said otherwise.
 *  - **the answer is validated by the loader's own parser, on the text being
 *    returned.** `applyPick` cannot hand back a file the boot would refuse, and
 *    the schema is the only validator (D-014).
 */

/** The fields a pick proved, in the shape the config owns (fetch maps its own into this). */
export interface PickPatchFields {
  readonly title: string;
  /** `undefined` is a fact: the pick proved the items carry their own `href`. */
  readonly link?: string | undefined;
  /** `undefined` is a fact: no deck resolved on every item. The reader's own stays. */
  readonly summary?: string | undefined;
}

export interface PickPatch {
  readonly list: string;
  readonly fields: PickPatchFields;
  /** The count `list` matched in the fetched bytes: D-026's baseline. */
  readonly matchCount: number;
  /** True when only a positional selector held. The file carries no such field, so the message does. */
  readonly positional: boolean;
}

export type ApplyPickResult =
  | { readonly ok: true; readonly text: string; readonly messages: readonly string[] }
  | { readonly ok: false; readonly messages: readonly string[] };

const refused = (messages: readonly string[]): ApplyPickResult => ({ ok: false, messages });

const isItemSource = (spec: SourceSpec): spec is HtmlItemSource =>
  spec.kind === 'html' && (spec as HtmlItemSource).list !== null && (spec as HtmlItemSource).list !== undefined;

const mergeFields = (spec: HtmlItemSource, patch: PickPatch, messages: string[]): HtmlFields => {
  const fields: HtmlFields = { ...spec.fields, title: patch.fields.title };
  if (patch.fields.link === undefined) {
    if (spec.fields.link !== undefined) {
      delete fields.link;
      messages.push(
        'fields.link removed: the pick proved every item carries its own href, and linkFrom reads that first',
      );
    }
  } else {
    fields.link = patch.fields.link;
  }
  if (patch.fields.summary === undefined) {
    if (spec.fields.summary !== undefined) {
      messages.push('fields.summary kept as you wrote it: the pick derived no deck that resolved on every item');
    }
  } else {
    fields.summary = patch.fields.summary;
  }
  return fields;
};

const mergeRender = (spec: HtmlItemSource, messages: string[]): boolean => {
  if (!spec.render) return false;
  messages.push('render set to false: the selectors were proved on the bytes the poller fetches (D-007)');
  return false;
};

const PICK_LABEL = 'the pick (editor text)';

/**
 * Merge a pick into a source file's text. `rawText` is the file the reader has open
 * in the editor, so the merge sees what they see; the result is re-parsed by
 * `parseSourceJson` before it is returned.
 */
export const applyPick = (rawText: string, patch: PickPatch): ApplyPickResult => {
  const parsed = parseSourceJson(rawText, PICK_LABEL);
  if (!parsed.ok) {
    return refused([
      'the pick wrote nothing: the editor text does not validate, so the loader cannot be asked to accept a merge of it',
      ...parsed.issue.messages,
    ]);
  }
  const spec = parsed.spec;
  if (!isItemSource(spec)) {
    return refused([
      spec.kind === 'html'
        ? 'the pick wrote nothing: this is a page source, and a page has no list to pick (D-028)'
        : `the pick wrote nothing: a pick writes an html source's list and fields, and this source is '${spec.kind}'`,
    ]);
  }

  const messages: string[] = [];
  const merged: HtmlItemSource = {
    ...spec,
    list: patch.list,
    fields: mergeFields(spec, patch, messages),
    render: mergeRender(spec, messages),
    matchCount: patch.matchCount,
  };

  if (spec.matchCount !== undefined && spec.matchCount !== patch.matchCount) {
    messages.push(
      `matchCount re-based: the file said ${String(spec.matchCount)}, the fetched bytes match ${String(patch.matchCount)}`,
    );
  } else if (spec.matchCount === undefined) {
    messages.push(
      `matchCount set to ${String(patch.matchCount)}: the count the poll compares the next page against (D-026)`,
    );
  }
  if (patch.positional) {
    messages.push(`'${patch.list}' is positional (:nth-child): it holds while the page keeps this shape`);
  }

  const text = `${JSON.stringify(merged, null, 2)}\n`;
  const check = parseSourceJson(text, PICK_LABEL);
  if (!check.ok) {
    return refused(['the pick wrote nothing: the merged text does not validate', ...check.issue.messages]);
  }
  return { ok: true, text, messages };
};
