import type { SourceSpec } from 'newspa-config';
import { fetchSource, NO_BASELINE, type TransportDeps } from 'newspa-fetch';

/**
 * The bytes a pick proves its selector against (WP6, D-036), in one place, so the
 * route and `pnpm pick` fetch the way **the poller** fetches.
 *
 * A selector proved against bytes from a different transport is a selector proved
 * against nothing, which is the trap D-007 records: the DOM a browser hydrated is
 * not the DOM `fetch` returns. So the pick's proof runs on this function's answer,
 * with the source's own headers, limits and timeouts.
 *
 * Two refusals are the honest ones, and both arrive as the transport's own name:
 *
 *  - `credential-required` — a `profile: true` source. The plain transport never
 *    authenticates (rule 17), and the pick's window is a logged-in profile while the
 *    poll is not: the page the reader clicked **cannot be fetched**, so no selector
 *    can be proved for it. Saying so beats writing a selector that will match
 *    nothing at 3am;
 *  - `render-required` — a `render: true` source, whose list is built by script
 *    (D-007's shape, named at pick time by `path-unmapped` and at poll time by the
 *    transport).
 *
 * `NO_BASELINE` is deliberate: a conditional GET that answered `304` would leave the
 * derivation with no document to read.
 */
export const pickTextFetcher =
  (deps: TransportDeps): ((spec: SourceSpec, url: string) => Promise<string>) =>
  async (spec, url) => {
    const res = await fetchSource({ ...spec, url }, NO_BASELINE, deps);
    if (res.state === 'ok') return res.text;
    throw new Error(
      res.state === 'failure'
        ? `${res.reason}: ${res.detail}`
        : 'the publisher answered 304: the pick needs bytes to prove a selector against',
    );
  };
