/**
 * The household write (D-034, the W4 ruling): `{id, patch}` to an existing source,
 * or `{create}` for a new one by URL. Split from `sourcesApi.ts` at rule 1's cap;
 * the route bag picks between the two writers by the peer's scope.
 *
 * The body never carries file text, and the merge (`applyHouseholdPatch`) never
 * touches a key outside the household shape, so `watchwords`, `blockwords`, `notes`,
 * `headers` and every selector travel through the write untouched — the peer never
 * saw them, so it cannot leak them (rule 18).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyHouseholdPatch, parseSourceJson, specOfHouseholdCreate, writeSource } from 'newspa-config';
import { householdCreateSchema, householdPatchSchema, householdWriteSchema } from 'newspa-core';
import type { ApiAnswer, SourcesApiDeps } from './sourcesApi.ts';

/** The answer shape every sources write shares, built once. */
export const answered = (status: number, ok: boolean, file: string | null, messages: readonly string[]): ApiAnswer => ({
  status,
  body: { ok, file, messages: [...messages] },
});

/** The reason a source stops being polled, printed in the answer that disables it. */
export const renderNote = (spec: { readonly render: boolean }): string[] =>
  spec.render === true
    ? [
        'this source asks for `render: true`, which the transport refuses by name until the browser tier exists (roadmap WP6, D-033)',
      ]
    : [];

/** A zod refusal, in the lines the form prints — one shape for every refused body. */
export const zodLines = (
  issues: readonly { readonly path: readonly unknown[]; readonly message: string }[],
): string[] => issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

/**
 * A household write: patch the knobs, or add by URL.
 *
 * A file that does not parse is **not patched**: patching it would rewrite bytes the
 * household scope cannot read, over a verdict the household form cannot show. The
 * answer says the file needs the desk, and writes nothing. An **add never
 * overwrites**: a create over an existing id refuses with the file byte-identical,
 * because the peer cannot read what it would clobber.
 */
export const writeHousehold = async (deps: SourcesApiDeps, raw: unknown): Promise<ApiAnswer> => {
  const body = householdWriteSchema.safeParse(raw);
  if (body.success === false) {
    return answered(400, false, null, zodLines(body.error.issues));
  }
  const data = body.data;
  if ('patch' in data) {
    const patch = householdPatchSchema.safeParse(data.patch);
    if (patch.success === false) {
      deps.log(
        `sources: refused a household patch to "${data.id}" — ${patch.error.issues[0]?.message ?? 'no knobs named'}`,
      );
      return answered(400, false, null, zodLines(patch.error.issues));
    }
    const name = `${data.id}.json`;
    const parsed = parseSourceJson(await readFile(join(deps.dir, name), 'utf8').catch(() => ''), name);
    if (parsed.ok === false) {
      return answered(400, false, null, [
        ...parsed.issue.messages.map((message) => `[${parsed.issue.reason}] ${message}`),
        `${name} needs the desk's editor: a household device moves switches, it does not rewrite a file it cannot read`,
      ]);
    }
    const next = applyHouseholdPatch(parsed.spec, patch.data);
    const target = await writeSource(deps.dir, next);
    deps.db.sources.upsert(next, deps.now().toISOString());
    deps.log(`sources: household patch landed on ${target}`);
    return answered(200, true, target, [
      `wrote ${target}`,
      'the switches moved; the source’s own words stayed in the file, untouched',
      ...renderNote(next),
    ]);
  }
  const create = householdCreateSchema.safeParse(data.create);
  if (create.success === false) {
    return answered(400, false, null, zodLines(create.error.issues));
  }
  const spec = specOfHouseholdCreate(create.data);
  const exists = await readFile(join(deps.dir, `${spec.id}.json`), 'utf8').then(
    () => true,
    () => false,
  );
  if (exists) {
    return answered(400, false, null, [
      `${spec.id}.json already exists: a household device adds, it does not overwrite. Turn it off, or edit it from the desk`,
    ]);
  }
  const target = await writeSource(deps.dir, spec);
  deps.db.sources.upsert(spec, deps.now().toISOString());
  deps.log(`sources: household added ${target}`);
  return answered(200, true, target, [
    `wrote ${target}`,
    'the row is refreshed, so the paper shows it and the next batch polls it first',
    ...renderNote(spec),
  ]);
};
