import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

/**
 * Generates `schemas/*.schema.json` from the zod definitions in
 * `packages/config/src`. `io: 'input'` because these documents are *inputs* to
 * the tool (a watchlist you import, a source file you write), so defaults are
 * optional in the schema even though they are required in the parsed value.
 *
 * The `$id` is the URL `packages/config/src/schemaUrls.ts` puts in every
 * exported file's `$schema`, which is how editors find the schema. Run
 * `pnpm schemas:check` in CI/`pnpm check`: a source file that changed without a
 * regeneration fails the gate, so the published schema cannot drift from the
 * code that validates it.
 */
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'schemas');
const CONFIG_SRC = path.join(ROOT, 'packages', 'config', 'src');

/** The `$id` builder is imported from the runtime constant, never copied here: a
 * second spelling of the URL is how the published `$id` ended up pointing at a
 * repository that does not exist (measured 404 at raw.githubusercontent.com). */

const descriptions = {
  watchlist: 'Interests for newspa: watch and block terms, scoped globally or to one source, plus source weights.',
  source:
    'One newspa source: an RSS feed, an HTML page with CSS selectors, or a JSON endpoint. Filename must equal id.',
  appconfig: 'newspa runtime configuration (newspa.config.json). Every section is optional; defaults fill in.',
  events: 'One newspa server-sent event frame payload, discriminated by kind.',
  bundle:
    'The whole reading list and the app config in one file. Rule 18: sources/ is gitignored, so this bundle is the backup of what a reader reads - keep it private, and keep a copy off the machine.',
};

const buildDocument = (schema, name, title, schemaUrlFor) => {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: schemaUrlFor(name),
    title,
    description: descriptions[name],
    ...json,
  };
};

const render = (document) => `${JSON.stringify(document, null, 2)}\n`;

/** Node's ESM resolver needs a file URL for an absolute Windows path. */
const importModule = async (file) => import(pathToFileURL(file).href);

const generate = async () => {
  const { schemaUrlFor } = await importModule(path.join(CONFIG_SRC, 'schemaUrls.ts'));
  const { watchlistSchema } = await importModule(path.join(CONFIG_SRC, 'watchlist.ts'));
  const { bundleSchema } = await importModule(path.join(CONFIG_SRC, 'bundle.ts'));
  const { appConfigSchema, sourceSchema } = await importModule(path.join(CONFIG_SRC, 'schema.ts'));
  const { serverEventSchema } = await importModule(path.join(ROOT, 'packages', 'core', 'src', 'api.ts'));

  const files = [
    ['watchlist.schema.json', buildDocument(watchlistSchema, 'watchlist', 'newspa watchlist', schemaUrlFor)],
    ['source.schema.json', buildDocument(sourceSchema, 'source', 'newspa source', schemaUrlFor)],
    ['appconfig.schema.json', buildDocument(appConfigSchema, 'appconfig', 'newspa app config', schemaUrlFor)],
    ['events.schema.json', buildDocument(serverEventSchema, 'events', 'newspa server event', schemaUrlFor)],
    ['bundle.schema.json', buildDocument(bundleSchema, 'bundle', 'newspa bundle', schemaUrlFor)],
  ];
  return files.map(([file, document]) => [file, render(document)]);
};

const check = async (generated) => {
  const problems = [];
  for (const [file, text] of generated) {
    const target = path.join(OUT, file);
    let onDisk;
    try {
      onDisk = await readFile(target, 'utf8');
    } catch {
      problems.push(`${file}: missing (run pnpm schemas:gen)`);
      continue;
    }
    if (onDisk !== text) problems.push(`${file}: out of date (run pnpm schemas:gen)`);
  }
  if (problems.length > 0) {
    process.stderr.write(`schema drift:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`schemas: ${generated.length} files match zod\n`);
};

const write = async (generated) => {
  await mkdir(OUT, { recursive: true });
  for (const [file, text] of generated) await writeFile(path.join(OUT, file), text, 'utf8');
  process.stdout.write(`schemas: wrote ${generated.length} files\n`);
};

const generated = await generate();
if (process.argv.includes('check')) await check(generated);
else await write(generated);
