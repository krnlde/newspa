import type { IncomingMessage, ServerResponse } from 'node:http';
import { pickRequestSchema } from 'newspa-core';
import type { HttpDeps } from './httpApp.ts';
import type { PeerDecision } from './net.ts';
import { BodyError, readJsonBody } from './requestBody.ts';
import { sendJson } from './response.ts';
import type { ApiAnswer } from './sourcesApi.ts';

/**
 * The pick route, as HTTP (WP6, D-036). `pickApi.ts` owns the job — the window, the
 * bytes, the merge, the sentence; this file owns the socket: the verbs, the body, the
 * address.
 *
 * Three rules the shape enforces:
 *
 *  - **the answer is immediate.** `POST` starts the job and answers `202`; a request
 *    that waits for a cursor is a request that dies in a proxy. The page reads the
 *    report with `GET`;
 *  - **the wall is the address, and it is computed for this route.** Launching a
 *    browser on a machine is a write (rule 20), and a pick reads the reading list
 *    (rule 18), so both verbs are loopback-only. The refusal names `/api/pick`,
 *    because a reason that points at another route's URL is a dead end;
 *  - **the body is an id, and the id schema is the guard.** The url, the headers and
 *    the `profile: true` fact belong to the source file (D-011): a request that
 *    carried its own url would be a fetch the reading list never agreed to.
 */

/** A pick body is an id. A kilobyte is the ceiling; anything larger is a lie. */
const MAX_PICK_BODY_BYTES = 1024;

/** The report shape, in the refusals: the page prints `messages`, so they carry the sentence. */
const pickRefusal = (message: string, status = 400): ApiAnswer => ({
  status,
  body: { ok: false, state: 'idle', sentence: '', messages: [message], text: null },
});

const pickStart = async (deps: HttpDeps, req: IncomingMessage): Promise<ApiAnswer> => {
  let raw: unknown;
  try {
    raw = await readJsonBody(req, MAX_PICK_BODY_BYTES);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return pickRefusal(message, cause instanceof BodyError ? cause.status : 400);
  }
  const parsed = pickRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return pickRefusal(
      `the pick body is {"id": "<source id>"}: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`,
    );
  }
  return deps.pick.start(parsed.data.id);
};

/** The pick route: `POST {"id": …}` opens a window, `GET ?id=…` reports the job. */
export const pickRoute = async (
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  list: PeerDecision,
): Promise<void> => {
  if (list.allowed === false) {
    deps.log(`refused ${method} /api/pick: ${list.reason}`);
    sendJson(res, 403, { error: list.reason });
    return;
  }
  const query = new URL(req.url ?? '/api/pick', 'http://internal');
  if (method === 'GET') {
    const answer = deps.pick.status(query.searchParams.get('id') ?? '');
    sendJson(res, answer.status, answer.body);
    return;
  }
  if (method === 'POST') {
    const answer = await pickStart(deps, req);
    sendJson(res, answer.status, answer.body);
    return;
  }
  sendJson(res, 405, {
    error: '/api/pick is POST {"id": "…"} to open a pick window, and GET ?id=… to report it',
  });
};
