/**
 * The sources routes (WP14): the reading list, as files, over HTTP.
 *
 * Three rules decide every answer here, and all three come from the repo's own law:
 *
 *  - **the file is the truth** (D-011, D-025). A write is `writeSource(dir, spec)` and
 *    the answer names the path. Nothing is stored in SQLite that the files do not
 *    agree with; the row is a runnable copy, upserted exactly as boot upserts it.
 *  - **the schema is the validator** (D-014). The request is raw file *text* — core's
 *    `addSourceRequestSchema` — and `parseSourceJson` (the loader's own) is what says
 *    yes or no. The browser carries no second copy of the source schema, so it cannot
 *    drift, and an invalid body is answered with the zod issues and **writes nothing**.
 *  - **a deletion is stated, not performed silently.** `DELETE` removes the file and
 *    **disables the row**: the poll stops, the strip says so, and the items survive —
 *    a story's history outlives the source that carried it.
 *
 * The address is the access control (D-034): `httpApp.ts` refuses every write from a
 * non-loopback peer **before routing**, so nothing here authenticates, and rule 20
 * forbids adding a token to make a LAN write "safe". `writable` in the list answer is
 * not a permission check — it is the same fact, told to a reader on a phone so the
 * form can say "editing is from this machine only" instead of offering a Save button
 * that is guaranteed to fail.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSourceJson, removeSource, type SourceSpec, writeSource } from 'newspa-config';
import { addSourceRequestSchema, type SourcesResponse, sourceIdSchema } from 'newspa-core';
import type { Database } from 'newspa-db';

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
  /** The list, with the peer's `writable` fact (D-034). */
  readonly list: (writable: boolean) => Promise<ApiAnswer>;
  /** A write of raw file text. Never partially applied. */
  readonly write: (raw: unknown) => Promise<ApiAnswer>;
  /** A removal by id: the file goes, the row is disabled. */
  readonly remove: (id: string) => Promise<ApiAnswer>;
}

const answered = (status: number, ok: boolean, file: string | null, messages: readonly string[]): ApiAnswer => ({
  status,
  body: { ok, file, messages: [...messages] },
});

/** The reason a source stops being polled, printed in the answer that disables it. */
const renderNote = (spec: SourceSpec): string[] =>
  spec.render === true
    ? [
        'this source asks for `render: true`, which the transport refuses by name until the browser tier exists (roadmap WP6, D-033)',
      ]
    : [];

/**
 * The list: every `*.json` in the directory, its text, and the verdict of the same
 * parser the loader uses (`parseSourceJson`, so the editor cannot disagree with the
 * poll).
 *
 * Two refusals are visible here, because both are things a reader can only fix by
 * looking: a file that does not parse (**rule 5** — the editor is where a broken
 * source gets fixed, so hiding it is the disappearance this project refuses), and a
 * file whose `id` is not its own name, which D-011 forbids: the directory listing is
 * the source list, and a file that lies about its id makes that listing a fiction.
 */
export const listSources = async (deps: SourcesApiDeps, writable: boolean): Promise<ApiAnswer> => {
  const names = await readdir(deps.dir, { withFileTypes: true })
    .then((entries) =>
      entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name),
    )
    .catch(() => [] as never[]);

  const view: SourcesResponse['files'] = [];
  for (const name of names.sort()) {
    const text = await readFile(join(deps.dir, name), 'utf8').catch(() => '');
    const parsed = parseSourceJson(text, name);
    const issues: string[] = [];
    let id: string | null = null;
    let kind: string | null = null;
    let label: string | null = null;
    if (parsed.ok === true) {
      if (`${parsed.spec.id}.json` === name) {
        id = parsed.spec.id;
        kind = parsed.spec.kind;
        label = parsed.spec.label;
      } else {
        issues.push(`"${name}" declares id "${parsed.spec.id}": the filename is the id (D-011)`);
      }
    } else {
      issues.push(...parsed.issue.messages.map((message) => `[${parsed.issue.reason}] ${message}`));
    }
    const row = id === null ? undefined : deps.db.sources.get(id);
    view.push({
      file: name,
      id,
      kind,
      label,
      text,
      issues,
      enabled: row?.spec.enabled ?? id !== null,
      state: row?.health ?? null,
    });
  }
  if (names.length === 0) deps.log('sources: the directory is empty');
  return { status: 200, body: { dir: deps.dir, files: view, writable } satisfies SourcesResponse };
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
  list: (writable) => listSources(deps, writable),
  write: (raw) => writeSourceText(deps, raw),
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
