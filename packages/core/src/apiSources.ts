/**
 * The source-file contract (WP14, D-034, the W4 ruling): what `/api/sources` answers,
 * and what each peer may answer it with.
 *
 * Split from `api.ts` at rule 1’s cap, and re-exported there, so a consumer imports
 * the wire from one module. The rule the shapes carry: the desk gets the file’s own
 * text; a household device on the LAN gets the **switches** and never the text, which
 * is where `watchwords`, `notes` and `headers` live (rule 18).
 */
import { z } from 'zod';
import { healthStateSchema } from './apiParts.ts';

export const addSourceRequestSchema = z.object({
  /** Raw file text. The server validates with the config schema so the web app
   *  never needs a second copy of the source schema. */
  text: z.string().min(2),
  filename: z.string().min(1).max(80).optional(),
});

export const addSourceResponseSchema = z.object({
  ok: z.boolean(),
  file: z.string().nullable(),
  messages: z.array(z.string()),
});

/**
 * One source **file**, as the sources panel sees it (WP14).
 *
 * The editor edits **text**, not fields: the file is the truth (D-011, D-025), the
 * config schema is the validator (so the browser never carries a second copy of the
 * source schema), and an `html` source's selectors are plain JSON that no form can
 * validate better than the schema does. `text` is therefore the file's own bytes,
 * and `issues` is the loader's own report about it — a file that does not parse is
 * listed with its issues, not hidden, which is rule 5 applied to the editor: the
 * reader learns about a broken source where they read the paper.
 */
export const sourceFileViewSchema = z.object({
  /** The name on disk, e.g. `bbc-world.json`. */
  file: z.string(),
  /** The id the file declares; `null` when the file did not parse. */
  id: z.string().nullable(),
  kind: z.string().nullable(),
  label: z.string().nullable(),
  /** The file's text, verbatim. This is what the editor edits and posts back. */
  text: z.string(),
  /** Every loader issue for this file, in the loader's words. Empty means it parses. */
  issues: z.array(z.string()),
  /** The row the boot upserted. `false` for a file that never parsed. */
  enabled: z.boolean(),
  /** The source's health from the last poll; `null` when there is no row. */
  state: healthStateSchema.nullable(),
});

/**
 * The answer to `DELETE /api/sources?id=…` — the same shape as a write, because it
 * reports the same fact: what happened, which file, and the lines.
 *
 * Deleting **removes the file and disables the row.** It does not delete items:
 * a story's history outlives the source that carried it (the paper keeps items
 * forever), and a source that stops existing must stop polling and say so, not
 * vanish from the strip (rule 5).
 */
export const deleteSourceResponseSchema = addSourceResponseSchema;

export const sourceIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case');

/**
 * What **this peer** may see and do with the source files (D-034, the W4 ruling).
 *
 * `full` is the machine that runs the server: the file's own text, every field.
 * `household` is a device on the LAN: the **switches** — enabled, section, weight,
 * cadence, label, url — and no file text at all, because the text carries
 * `watchwords`, `blockwords`, `notes` and `headers`, which are a statement about
 * what a reader cares about (rule 18) and stay the desk's.
 */
export const sourcesScopeSchema = z.enum(['full', 'household']);

/**
 * The household field set, in **one** place (D-034's W4 ruling): the shape of what a
 * LAN device may read (`householdSourceViewSchema`) and what it may write
 * (`householdPatchSchema`, `householdCreateSchema`). `packages/config` re-exports these
 * and owns the merge into a real source spec, so the ranges a form is built from and
 * the ranges a write is validated by are the same numbers — a second copy of
 * `weight: 0…5` is how a knob starts to lie to its own schema.
 */
const householdShape = {
  label: z.string().min(1).max(80),
  url: z.url(),
  /** `null` unsets it, so the ladder routes the source again. A state, not an absence. */
  group: z.string().min(1).max(60).nullish(),
  section: z.string().min(1).max(60).nullish(),
  cadenceMinutes: z.int().min(1).max(43_200),
  enabled: z.boolean(),
  weight: z.int().min(0).max(5),
};

/**
 * A change to an existing source: at least one knob, and no key outside this shape is
 * ever applied. The defaults are **absent by design** (config's own file schema applies
 * them): a patch of only fields this shape does not name means "change nothing", and a
 * defaulted `weight` would turn that into a write.
 */
export const householdPatchSchema = z
  .object(householdShape)
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'name at least one field to change',
  });

/**
 * A new source, added by URL: `rss` and `html` only. A `json` source is a selector
 * contract (`itemsPath`, `fields`) — authoring, which is the desk's. An `html` source
 * with no `list` is page mode (D-028), so a version page, a status page and a
 * changelog are all addable from the couch.
 */
export const householdCreateSchema = z.object({
  id: sourceIdSchema,
  kind: z.enum(['rss', 'html']),
  label: householdShape.label,
  url: householdShape.url,
  group: householdShape.group.optional(),
  section: householdShape.section.optional(),
  cadenceMinutes: householdShape.cadenceMinutes.default(20),
  enabled: householdShape.enabled.default(true),
  weight: householdShape.weight.default(1),
});

/** One source, as a household device sees it: the knobs, and nothing private. */
export const householdSourceViewSchema = z.object({
  file: z.string(),
  id: z.string().nullable(),
  kind: z.string().nullable(),
  label: z.string().nullable(),
  url: z.string().nullable(),
  section: z.string().nullable(),
  group: z.string().nullable(),
  // Absent when the file did not parse: the view says what is known, and the issues
  // say why the rest is not. A defaulted `0` would be a knob the file never set.
  weight: z.int().min(0).max(5).optional(),
  enabled: z.boolean(),
  cadenceMinutes: z.int().min(1).optional(),
  issues: z.array(z.string()),
  state: healthStateSchema.nullable(),
});

/**
 * The answer to `GET /api/sources`, in **two scopes** (D-034, the W4 ruling): the desk
 * gets the file text, a household device gets the switches. `writable` is the blunt
 * fact the form needs — the peer may write at all — and `scope` is what it may write,
 * so a phone never meets a textarea whose text it was never sent.
 */
/** The watchlist directory, as the server sees it. The desk's own path. */
/** The files, verbatim: this is what the desk's editor edits and posts back. */
/** No `dir`: a path on the desk is not a fact a phone needs, and no file text. */
export const sourcesResponseSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('full'),
    dir: z.string(),
    /** The files, verbatim: this is what the desk's editor edits and posts back. */
    files: z.array(sourceFileViewSchema),
    writable: z.boolean(),
  }),
  z.object({
    scope: z.literal('household'),
    /** The directory is not sent: a path on the desk is nobody's business but its own. */
    files: z.array(householdSourceViewSchema),
    writable: z.boolean(),
  }),
]);

/**
 * A household write: the id and the knobs. The **field names and ranges are
 * validated by `newspa-config`'s household schema** (D-014: the schema is the
 * validator, and it has one owner), so this envelope says only that a body is an id
 * beside a bag of values — a second copy of the source schema in the wire contract
 * is a copy that can drift.
 */
export const patchSourceRequestSchema = z.object({
  id: sourceIdSchema,
  patch: z.record(z.string(), z.unknown()),
});

/** A household add: the new source's fields, validated by the same config schema. */
export const createSourceRequestSchema = z.object({
  create: z.record(z.string(), z.unknown()),
});

/** The two household bodies, and only these: the desk's verbatim text is not among them. */
export const householdWriteSchema = z.union([patchSourceRequestSchema, createSourceRequestSchema]);

export type AddSourceRequest = z.infer<typeof addSourceRequestSchema>;
export type AddSourceResponse = z.infer<typeof addSourceResponseSchema>;
export type SourceFileView = z.infer<typeof sourceFileViewSchema>;
export type HouseholdSourceView = z.infer<typeof householdSourceViewSchema>;
export type HouseholdPatch = z.infer<typeof householdPatchSchema>;
export type HouseholdCreate = z.infer<typeof householdCreateSchema>;
export type SourcesScope = z.infer<typeof sourcesScopeSchema>;
export type PatchSourceRequest = z.infer<typeof patchSourceRequestSchema>;
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type SourcesResponse = z.infer<typeof sourcesResponseSchema>;
