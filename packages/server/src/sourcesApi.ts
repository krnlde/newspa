/**
 * The sources routes (WP14): the reading list, as files, over HTTP.
 *
 * Four rules decide every answer here, and all four are the repo's own law:
 *
 *  - **the file is the truth** (D-011, D-025). A write is `writeSource(dir, spec)` and
 *    the answer names the path. Nothing is stored in SQLite that the files do not
 *    agree with; the row is a runnable copy, upserted exactly as boot upserts it.
 *  - **the schema is the validator** (D-014). A desk write is raw file *text* and
 *    `parseSourceJson` (the loader's own) says yes or no; a household write is a
 *    **patch of knobs**, validated by core's household schema and merged by config's
 *    `applyHouseholdPatch`. The browser carries no second copy of the source schema,
 *    so it cannot drift, and an invalid body is answered with the zod issues and
 *    **writes nothing**.
 *  - **a deletion is stated, not performed silently.** `DELETE` removes the file and
 *    **disables the row**: the poll stops, the strip says so, and the items survive —
 *    a story's history outlives the source that carried it.
 *  - **the peer's scope decides what is sent** (D-034, the W4 ruling). The desk sees the
 *    file text; a household device sees the **switches** — and so the private fields
 *    (`watchwords`, `blockwords`, `notes`, `headers`) never travel, are never in that
 *    browser, and cannot be posted back. Rule 18's reading list stays the desk's.
 *
 * The address is the access control: `net.ts` decides the scope **before routing**, and
 * rule 20 forbids a token, cookie or shared secret as the substitute. `writable` in the
 * list answer is not a permission check — it is the same fact, told to a form so it
 * never offers a control the server would refuse.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSourceJson, removeSource, type SourceSpec, writeSource } from 'newspa-config';
import {
  addSourceRequestSchema,
  type HouseholdSourceView,
  type SourceFileView,
  type SourcesResponse,
  type SourcesScope,
  sourceIdSchema,
} from 'newspa-core';
import type { Database } from 'newspa-db';
import { answered, renderNote, writeHousehold } from './sourcesHousehold.ts';

/** A body over this size is a mistake or an attack, and 413 says which. */
export const MAX_SOURCE_BODY_BYTES = 64 * 1024;

export interface SourcesApiDeps {
  /** The watchlist directory (D-025: local, gitignored, the reader's list). */
  readonly dir: string;
  readonly db: Database;
  readonly now: () => Date;
  readonly log: (line: string) => void;
}

export interface ApiAnswer {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The three source routes, as a bag of functions, so `httpApp.ts` routes them and a
 * test drives them directly (the file system and SQLite are the facts; the socket
 * adds nothing to them). `start.ts` builds this from an open db and the directory.
 */
export interface SourcesRoutes {
  /** The list, in the peer's scope (D-034, W4): file text for the desk, switches for the household. */
  readonly list: (scope: SourcesScope) => Promise<ApiAnswer>;
  /** A write. The desk posts file text; a household device posts a patch or a create (W4). */
  readonly write: (raw: unknown, scope: SourcesScope) => Promise<ApiAnswer>;
  /** A removal by id: the file goes, the row is disabled. Loopback-only (rule 20). */
  readonly remove: (id: string) => Promise<ApiAnswer>;
}

/** One file on disk, read and parsed once, for whichever scope will render it. */
interface ParsedFile {
  readonly name: string;
  readonly text: string;
  /** The parsed spec, or `null` with the loader's issues: a broken file is listed, not hidden (rule 5). */
  readonly spec: SourceSpec | null;
  readonly issues: readonly string[];
  /** The id, but only when the file declares the id its filename names (D-011). */
  readonly id: string | null;
}

type SourceRow = NonNullable<ReturnType<Database['sources']['get']>>;

/**
 * Every `*.json` in the directory, with the verdict of the same parser the loader uses
 * (`parseSourceJson`, so the editor cannot disagree with the poll).
 *
 * Two refusals are visible here, because both are things a reader can only fix by
 * looking: a file that does not parse (**rule 5** — the editor is where a broken
 * source gets fixed, so hiding it is the disappearance this project refuses), and a
 * file whose `id` is not its own name, which D-011 forbids: the directory listing is
 * the source list, and a file that lies about its id makes that listing a fiction.
 */
const readSourceFiles = async (dir: string): Promise<ParsedFile[]> => {
  const names = await readdir(dir, { withFileTypes: true })
    .then((entries) =>
      entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name),
    )
    .catch(() => [] as never[]);
  const files: ParsedFile[] = [];
  for (const name of names.sort()) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    const parsed = parseSourceJson(text, name);
    if (parsed.ok === true) {
      if (`${parsed.spec.id}.json` === name) {
        files.push({ name, text, spec: parsed.spec, issues: [], id: parsed.spec.id });
      } else {
        files.push({
          name,
          text,
          spec: parsed.spec,
          id: null,
          issues: [`"${name}" declares id "${parsed.spec.id}": the filename is the id (D-011)`],
        });
      }
    } else {
      files.push({
        name,
        text,
        spec: null,
        id: null,
        issues: parsed.issue.messages.map((message) => `[${parsed.issue.reason}] ${message}`),
      });
    }
  }
  return files;
};

/** The desk's view: the file's own bytes, which is what its editor edits and posts back. */
const fullViewOf = (file: ParsedFile, row: SourceRow | undefined): SourceFileView => ({
  file: file.name,
  id: file.id,
  kind: file.spec?.kind ?? null,
  label: file.spec?.label ?? null,
  text: file.text,
  issues: [...file.issues],
  enabled: row?.spec.enabled ?? file.spec !== null,
  state: row?.health ?? null,
});

/**
 * The household view: the switches, and nothing else. No `text`, so the file's
 * `watchwords`, `blockwords`, `notes` and `headers` never reach this peer (rule 18).
 * `weight` and `cadenceMinutes` are absent for a file that did not parse: the view says
 * what is known, and the issues say why the rest is not.
 */
const householdViewOf = (file: ParsedFile, row: SourceRow | undefined): HouseholdSourceView => ({
  file: file.name,
  id: file.id,
  kind: file.spec?.kind ?? null,
  label: file.spec?.label ?? null,
  url: file.spec?.url ?? null,
  section: file.spec?.section ?? null,
  group: file.spec?.group ?? null,
  ...(file.spec === null ? {} : { weight: file.spec.weight, cadenceMinutes: file.spec.cadenceMinutes }),
  issues: [...file.issues],
  enabled: row?.spec.enabled ?? file.spec !== null,
  state: row?.health ?? null,
});

/**
 * The list, in the peer's scope (D-034, W4): `full` is the desk's editor, `household`
 * is the switches a device on the network reads and moves.
 */
export const listSources = async (deps: SourcesApiDeps, scope: SourcesScope): Promise<ApiAnswer> => {
  const files = await readSourceFiles(deps.dir);
  const rowOf = (file: ParsedFile): SourceRow | undefined =>
    file.id === null ? undefined : deps.db.sources.get(file.id);
  if (files.length === 0) deps.log('sources: the directory is empty');
  if (scope === 'household') {
    return {
      status: 200,
      body: {
        scope,
        files: files.map((file) => householdViewOf(file, rowOf(file))),
        writable: true,
      } satisfies SourcesResponse,
    };
  }
  return {
    status: 200,
    body: {
      scope: 'full',
      dir: deps.dir,
      files: files.map((file) => fullViewOf(file, rowOf(file))),
      writable: true,
    } satisfies SourcesResponse,
  };
};

/**
 * A write: parse with the loader's own function, write the file, refresh the row.
 *
 * The row is upserted on a successful write, which is what makes a new source appear
 * in the paper **before** its first poll (`stateOf` reads rows) — and `next_run_at`
 * stays null, so `dueSources` takes it first in the next batch.
 *
 * The file written is always `<id>.json`. A `filename` in the request is therefore
 * checked, not obeyed: an editor that posts `evil.json` with `id: "bbc"` would
 * otherwise create a second name for a source, and D-011's one-file-per-id rule is
 * what makes a source list readable by looking at a directory.
 */
export const writeSourceText = async (deps: SourcesApiDeps, raw: unknown): Promise<ApiAnswer> => {
  const request = addSourceRequestSchema.safeParse(raw);
  if (request.success === false) {
    return answered(
      400,
      false,
      null,
      request.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const posted = request.data.filename;
  const parsed = parseSourceJson(request.data.text, posted ?? '(the posted text)');
  if (parsed.ok === false) {
    deps.log(`sources: refused a write — ${parsed.issue.file} [${parsed.issue.reason}]`);
    return answered(400, false, null, parsed.issue.messages);
  }
  const spec = parsed.spec;
  const expected = `${spec.id}.json`;
  if (posted !== undefined && posted !== expected) {
    return answered(400, false, null, [
      `the file written is "${expected}" (the id is the filename, D-011); "${posted}" is not it`,
    ]);
  }
  const target = await writeSource(deps.dir, spec);
  deps.db.sources.upsert(spec, deps.now().toISOString());
  deps.log(`sources: wrote ${target}`);
  return answered(200, true, target, [
    `wrote ${target}`,
    'the row is refreshed, so the paper shows it and the next batch polls it first',
    ...renderNote(spec),
  ]);
};

/** The route bag, from the deps: what `start.ts` hands `httpApp.ts`. */
export const sourcesRoutesOf = (deps: SourcesApiDeps): SourcesRoutes => ({
  list: (scope) => listSources(deps, scope),
  write: (raw, scope) => (scope === 'household' ? writeHousehold(deps, raw) : writeSourceText(deps, raw)),
  remove: (id) => deleteSource(deps, id),
});

/**
 * A deletion: remove the file, disable the row. `sourceIdSchema` is the traversal
 * guard — an id is lowercase kebab-case, so `..%2f` cannot name a path.
 */
export const deleteSource = async (deps: SourcesApiDeps, rawId: string): Promise<ApiAnswer> => {
  const id = sourceIdSchema.safeParse(rawId);
  if (id.success === false) {
    return answered(400, false, null, [`id: ${id.error.issues[0]?.message ?? 'not a source id'}`]);
  }
  const target = join(deps.dir, `${id.data}.json`);
  const existed = await readFile(target, 'utf8').then(
    () => true,
    () => false,
  );
  if (!existed) {
    return answered(404, false, null, [`no source file named ${id.data}.json in ${deps.dir}`]);
  }
  await removeSource(deps.dir, id.data);
  deps.db.sources.setEnabled(id.data, false);
  deps.log(`sources: removed ${target}; the row is disabled, its items stay`);
  return answered(200, true, target, [
    `removed ${target}`,
    'the source is disabled, so it is not polled; its items and history stay, and the row is a record, not a runnable copy (D-011)',
  ]);
};
