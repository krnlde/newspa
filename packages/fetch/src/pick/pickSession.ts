import { derivePick } from './derivePick.ts';
import { parseFingerprint } from './fingerprint.ts';
import type { PickLaunchOptions, PickSessionResult } from './launch.ts';
import type { PickFingerprint, PickSuccess } from './types.ts';

/**
 * One pick, end to end (WP6): a window opens, the reader clicks, the bytes are
 * fetched, the selector is proved, and one sentence comes out.
 *
 * It is a thin module on purpose, and it is thin by **injection**: the browser
 * (`launch`) and the transport (`fetchText`) arrive as arguments, so the sequence
 * is unit-tested in Node with a stub window, and the same sequence is run for real
 * against a local server in `test/browser/` (real Edge, a scripted click, the
 * bytes that server sent). The two layers share this file, which is what keeps
 * "tested" and "shipped" from being different code.
 *
 * The order is the argument for D-036. The fingerprint arrives from a browser DOM
 * that may be hydrated, and `fetchText` answers with the bytes the **poller** will
 * read; `derivePick` runs on those bytes. So the pick's answer is a statement about
 * the source, not about the session: a list the poller can read, or the named
 * reason it cannot (`path-unmapped` ⇒ D-007's `render`, and nothing is written).
 */

export interface PickDeps {
  /** The browser tier. In the test suite it is a stub; in `test/browser/` it is Edge. */
  readonly launch: (options: PickLaunchOptions) => Promise<PickSessionResult>;
  /** The plain transport, as the poller uses it: the bytes the selector must survive. */
  readonly fetchText: (url: string) => Promise<string>;
  readonly headless: boolean;
  readonly profileDir?: string;
  readonly budgetMs?: number;
  readonly navTimeoutMs?: number;
  readonly channel?: string;
  /** The driver seam, passed straight to the browser tier: a reader's hand, or a test. */
  readonly onArmed?: PickLaunchOptions['onArmed'];
}

export interface PickTarget {
  /** The address to open. A source's own URL, or the page the reader is aiming at. */
  readonly url: string;
  /** The source's label, for the sentence. */
  readonly label?: string;
}

/** Where the pick stopped. Every arm is a sentence, and only `derived` writes. */
export type PickRun =
  | { readonly ok: true; readonly stage: 'derived'; readonly fp: PickFingerprint; readonly outcome: PickSuccess }
  | {
      readonly ok: false;
      readonly stage: 'launch' | 'fingerprint' | 'fetch' | 'derive';
      readonly reason: string;
      readonly detail: string;
      readonly notes: readonly string[];
    };

const failed = (
  stage: 'launch' | 'fingerprint' | 'fetch' | 'derive',
  reason: string,
  detail: string,
  notes: readonly string[] = [],
): PickRun => ({ ok: false, stage, reason, detail, notes });

/**
 * The one sentence the CLI and the page print. It lives here so both say the same
 * thing in the same words, and so neither can round a fault off into "no items".
 */
export const describePickRun = (run: PickRun, target: PickTarget): string => {
  const named = target.label === undefined ? target.url : `${target.label} (${target.url})`;
  if (!run.ok) {
    const tail = run.notes.length === 0 ? '' : `\n  ${run.notes.join('\n  ')}`;
    return `pick wrote nothing for ${named}: ${run.stage} / ${run.reason}\n  ${run.detail}${tail}`;
  }
  const fields = Object.entries(run.outcome.fields)
    .map(([name, selector]) => `${name}: ${String(selector)}`)
    .join(', ');
  return [
    `pick: ${named}`,
    `  list       ${run.outcome.list}${run.outcome.positional ? ' (positional)' : ''}`,
    `  fields     ${fields}`,
    `  matchCount ${String(run.outcome.matchCount)} in the bytes the poller fetches`,
    `  reads      "${run.outcome.sample.title}" -> ${run.outcome.sample.link}`,
    ...run.outcome.notes.map((note) => `  note       ${note}`),
  ].join('\n');
};

export const runPick = async (target: PickTarget, deps: PickDeps): Promise<PickRun> => {
  const session = await deps.launch({
    url: target.url,
    headless: deps.headless,
    ...(deps.profileDir === undefined ? {} : { profileDir: deps.profileDir }),
    ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
    ...(deps.navTimeoutMs === undefined ? {} : { navTimeoutMs: deps.navTimeoutMs }),
    ...(deps.channel === undefined ? {} : { channel: deps.channel }),
    ...(deps.onArmed === undefined ? {} : { onArmed: deps.onArmed }),
  });

  if (!session.ok) {
    return failed('launch', session.reason, session.detail, [
      'a pick writes nothing until a click is captured, so the source is unchanged',
    ]);
  }

  const parsed = parseFingerprint(session.payload);
  if (!parsed.ok) {
    return failed('fingerprint', parsed.reason, parsed.detail, parsed.notes);
  }

  let rawHtml: string;
  try {
    rawHtml = await deps.fetchText(session.navigated);
  } catch (cause) {
    return failed(
      'fetch',
      'fetch-failed',
      `${session.navigated} could not be fetched the way the poller fetches it: ${cause instanceof Error ? cause.message : String(cause)}`,
      ['the selector is proved against those bytes, so a fetch that fails here fails in the poll too'],
    );
  }

  const outcome = derivePick(parsed.fp, rawHtml);
  if (!outcome.ok) {
    return failed('derive', outcome.reason, outcome.detail, outcome.notes);
  }
  return { ok: true, stage: 'derived', fp: parsed.fp, outcome };
};
