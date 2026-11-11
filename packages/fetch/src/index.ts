import type { SourceSpec } from 'newspa-config';
import type { Challenge } from './challenge.ts';
import { challengeOf } from './challenge.ts';
import { parseHtmlPayload } from './html.ts';
import { parseJsonPayload } from './json.ts';
import type { ParseResult } from './results.ts';
import { failWith } from './results.ts';
import { parseRssPayload } from './rss.ts';
import type { Sniffed } from './sniff.ts';
import { sniff } from './sniff.ts';

/**
 * The one entry point: payload text in, items or a **named** fault out.
 *
 * The order of the checks is the policy, and D-006 is the reason for it:
 * `old.reddit.com/r/worldnews/.rss` answers `200 text/html` while serving a
 * feed, and a Cloudflare wall answers `200 text/html` while serving nothing.
 * So the **bytes** decide the parser, and a payload that matches a challenge
 * marker outranks the kind mismatch — "blocked, marker 'just a moment'" is the
 * actionable note, "that is HTML, not a feed" only describes the symptom.
 */

const emptyFailure = (spec: SourceSpec): ParseResult =>
  failWith({
    reason: 'empty',
    kind: spec.kind,
    detail: 'the payload has no bytes to parse',
    notes: ['an empty body is a fetch problem, never "no news"'],
  });

const wallFailure = (spec: SourceSpec, sniffed: Sniffed, wall: Challenge, context: string): ParseResult =>
  failWith({
    reason: 'challenge',
    kind: spec.kind,
    detail: `the payload is a challenge page: '${wall.marker}' (${context})`,
    sniffed: sniffed.kind,
    marker: sniffed.marker,
    cause: wall.marker,
    notes: [
      sniffed.reason,
      `marker from ${wall.source === 'core' ? "core's CHALLENGE_MARKERS" : 'the extended wall list'}`,
    ],
  });

const kindFailure = (spec: SourceSpec, sniffed: Sniffed, detail: string): ParseResult =>
  failWith({
    reason: 'kind-mismatch',
    kind: spec.kind,
    detail,
    sniffed: sniffed.kind,
    marker: sniffed.marker,
    cause: sniffed.marker,
    notes: [sniffed.reason],
  });

/**
 * A JSON source with an `island` selector **is** a page: the schema's own words
 * are "when the JSON lives in a script island, the selector of that script tag",
 * and the measurement behind it is 91 KB of `__NEXT_DATA__` inside a 370 KB BBC
 * page (D-008). Refusing the page because its bytes are HTML is how the one
 * source shape that survives a redesign becomes unreachable.
 */
const islandInPage = (spec: SourceSpec, sniffed: Sniffed): boolean =>
  spec.kind === 'json' && spec.island !== undefined && sniffed.kind === 'html';

/**
 * Parse a payload. `text` is the **decoded** body: the transport layer owns the
 * charset (the schema's sources are URLs; a `<?xml encoding="ISO-8859-1"?>`
 * declaration is reported in the notes, never obeyed, because decoding bytes is
 * not this slice's job).
 */
export const parsePayload = (text: string, spec: SourceSpec): ParseResult => {
  if (text.trim().length === 0) return emptyFailure(spec);
  const sniffed = sniff(text);
  const wall = challengeOf(text);
  if (sniffed.kind === null) {
    if (wall !== null) return wallFailure(spec, sniffed, wall, `no feed, HTML or JSON marker: ${sniffed.reason}`);
    return kindFailure(
      spec,
      sniffed,
      `the source is a '${spec.kind}' source and the payload is not one: ${sniffed.reason}`,
    );
  }
  if (sniffed.kind !== spec.kind && !islandInPage(spec, sniffed)) {
    if (wall !== null) return wallFailure(spec, sniffed, wall, `served as ${sniffed.kind} to a '${spec.kind}' source`);
    return kindFailure(
      spec,
      sniffed,
      `the payload is ${sniffed.kind} (${sniffed.reason}) and the source is a '${spec.kind}' source; refusing to parse it as one (D-006)`,
    );
  }
  if (spec.kind === 'rss') return parseRssPayload(text, spec, sniffed);
  if (spec.kind === 'html') return parseHtmlPayload(text, spec, sniffed);
  return parseJsonPayload(text, spec, sniffed);
};

/** The sniffed kind of a payload, for a caller that wants it before parsing. */
export const sniffPayload = (text: string): Sniffed => sniff(text);

export { charsetFromContentType, decodeBody, mediaTypeOf, xmlDeclaredCharset } from './charset.ts';
export { withBase } from './item.ts';
/**
 * The picker's core (WP6, D-036): a click's fingerprint and the **raw bytes** in, a
 * selector and a named verdict out. It lives here because the proof is the parser's
 * own DOM — `collectNodes` and `fieldNode` are the code that will poll the file the
 * pick writes, so a selector that fails here would fail in the poll. The part that
 * needs a browser (`pick/launch.ts`, headed Edge) is not in this export list, and
 * `vitest.coverage.json` is where that is recorded.
 */
export { derivePick } from './pick/derivePick.ts';
export { parseFingerprint } from './pick/fingerprint.ts';
/**
 * The picker (WP6, D-036): the browser's click in, a proved selector out.
 *
 * `runPick` is the sequence, and it takes the browser and the transport as
 * arguments — the unit project runs it with a stub window, `test/browser/` runs
 * it in real Edge, and both call this one function. `describePickRun` is the
 * single sentence the CLI and the page print, so neither can round a fault off
 * into "no items" (rule 5). `openPickSession` is the browser tier, and the only
 * module `vitest.coverage.json` excludes.
 */
export { INSPECTOR_SOURCE, PICK_BINDING } from './pick/inspector.ts';
export {
  openPickSession,
  type PickLaunchFault,
  type PickLaunchOptions,
  type PickSessionResult,
  pickBudgetMs,
} from './pick/launch.ts';
export {
  describePickRun,
  type PickDeps,
  type PickRun,
  type PickTarget,
  runPick,
} from './pick/pickSession.ts';
export {
  outerHtmlCap,
  type PathStep,
  type PickFault,
  type PickFields,
  type PickFingerprint,
  type PickOutcome,
  type PickSample,
  pathMax,
  textCap,
} from './pick/types.ts';
/**
 * The result types, exported because the caller **is** the health layer: the
 * server maps a `ParseFailureReason` to a `HealthState`, and doing that needs
 * the union, not a cast.
 */
export type {
  FailFields,
  ParseFailure,
  ParseFailureReason,
  ParseResult,
  ParseSuccess,
  SkippedItem,
  SuccessInput,
} from './results.ts';
export { selectionHash, selectionText } from './selection.ts';
export { type FetchLike, fetchSource, refusalOf, type TransportDeps } from './transport.ts';
export { bodyHashOf, HASH_PREFIX, probeLimit, readCapped } from './transportBody.ts';
export { classifyThrown } from './transportErrors.ts';
export {
  ACCEPT_BY_KIND,
  baselineValidators,
  buildRequestHeaders,
  DEFAULT_USER_AGENT,
  FORBIDDEN_HEADERS,
  headerAccessor,
} from './transportHeaders.ts';
export {
  BACKOFF_MAX_MS,
  isRetryableFailure,
  isRetryableStatus,
  MAX_RETRIES,
  RETRYABLE_STATUS,
  retryPlan,
} from './transportRetry.ts';
/**
 * The transport, for the same reason: `FetchOutcome` is core's classification
 * **input** and carries `itemCount`, which only exists after a parse, so the
 * pipeline composes `TransportResult` + `ParseResult` into it. That composition
 * needs these types, not a cast.
 */
export {
  type BaselineState,
  describeTransport,
  failTransport,
  NO_BASELINE,
  type TransportFailure,
  type TransportFailureReason,
  type TransportNotModified,
  type TransportOk,
  type TransportResponseMeta,
  type TransportResult,
} from './transportTypes.ts';
