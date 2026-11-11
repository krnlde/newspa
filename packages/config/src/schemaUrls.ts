/**
 * Where the generated JSON Schema documents are published.
 *
 * A `$schema` value must be a URL a human and an editor can resolve, and an
 * editor matches by the schema's `$id`. zod is the source of truth; the files
 * at this URL are generated (`pnpm schemas:gen`) and a drift gate in
 * `pnpm check` fails if they were not regenerated.
 *
 * Single place, single constant: change the owner/repo here and every emitted
 * `$schema`, `$id` and editor mapping follows.
 */
export const SCHEMA_OWNER = 'krnlde';
export const SCHEMA_REPO = 'newspa';
export const SCHEMA_BRANCH = 'main';

export const SCHEMA_BASE_URL = `https://raw.githubusercontent.com/${SCHEMA_OWNER}/${SCHEMA_REPO}/${SCHEMA_BRANCH}/schemas`;

export const SCHEMA_NAMES = ['watchlist', 'source', 'appconfig', 'events', 'bundle'] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

export const schemaUrlFor = (name: SchemaName): string => `${SCHEMA_BASE_URL}/${name}.schema.json`;

/** The `$schema` value written into an exported watchlist. */
export const WATCHLIST_SCHEMA_URL = schemaUrlFor('watchlist');

/**
 * The `$schema` value written into a **bundle**. Rule 18 makes the bundle the only
 * backup of `sources/` (that tree is gitignored, deliberately), so its shape is
 * published like every other file format (D-014): a bundle that cannot be validated
 * on the way in is a backup you find out about at restore time.
 */
export const BUNDLE_SCHEMA_URL = schemaUrlFor('bundle');
