import { z } from 'zod';
import { sourceIdSchema } from './api.ts';

/**
 * The pick session's wire contract (WP6, D-036), as a module of its own: `api.ts`
 * is the paper's contract, and it is at the 300-line cap; the picker is a second
 * surface with a second lifetime (a job that exists for minutes, in one process),
 * so it is split by responsibility rather than trimmed of its comments.
 *
 * Two rules are visible in the shapes, and both are the repo's own law:
 *
 *  - **the request is an id, not a url.** The url, the headers, the limits and the
 *    `profile: true` fact belong to the source file, and the file is the truth
 *    (D-011). A request that carried its own url would be a fetch the reading list
 *    never agreed to — and a route that fetches an arbitrary address from a LAN
 *    peer is the wall D-034 refuses to lower;
 *  - **the report carries text, and no route writes a file.** `text` is the merged
 *    source file, and the pick **fills** the editor: SAVE stays the reader's act
 *    (D-036). `sentence` is written by `describePickRun` (packages/fetch), so the
 *    page and `pnpm pick` cannot tell two stories about one run.
 */

/** The job's state. Every arm is sayable in the page, and none of them is "no items". */
export const pickJobStateSchema = z.enum(['idle', 'running', 'picked', 'failed']);

/**
 * A pick session, asked for by the id of a source the reader already has
 * (`POST /api/pick`). `id` is the whole body on purpose: see the module header.
 */
export const pickRequestSchema = z.object({ id: sourceIdSchema });

/**
 * The report (`GET /api/pick?id=…`), as the page prints it. `running` is a state
 * the reader waits in, so the route is asynchronous: a request that waits for a
 * cursor is a request that dies in a proxy.
 */
export const pickStatusResponseSchema = z.object({
  ok: z.boolean(),
  state: pickJobStateSchema,
  /** The one sentence the CLI prints too. Printed verbatim, never re-derived in the page. */
  sentence: z.string(),
  /** What the merge did, what it refused to do, and why. Each line is the reader's to read. */
  messages: z.array(z.string()),
  /** The merged text, when the pick proved a selector; `null` in every other state. */
  text: z.string().nullable(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});

export type PickJobState = z.infer<typeof pickJobStateSchema>;
export type PickRequest = z.infer<typeof pickRequestSchema>;
export type PickStatusResponse = z.infer<typeof pickStatusResponseSchema>;
