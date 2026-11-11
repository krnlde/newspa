import { join } from 'node:path';
import { applyPick, type PickPatch, parseSourceJson, type SourceSpec } from 'newspa-config';
import {
  describePickRun,
  type PickDeps,
  type PickLaunchOptions,
  type PickRun,
  type PickSessionResult,
  runPick,
} from 'newspa-fetch';
import type { ApiAnswer } from './sourcesApi.ts';

/**
 * The pick, as a route and a command (WP6, D-036): the window opens, the reader
 * clicks, the bytes are proved, and the editor is filled.
 *
 * The route is **asynchronous on purpose**: a pick is a human act that takes
 * minutes, and an HTTP request that waits for a cursor is a request that dies in a
 * proxy. So `POST /api/pick` starts a job and answers at once, `GET /api/pick?id=`
 * reports it, and the page prints the report. Every state is sayable — `running`,
 * `picked`, `failed` — and the sentence is the same one the CLI prints
 * (`describePickRun`), so the two drivers cannot tell two stories.
 *
 * Four rules the shape enforces:
 *
 *  - **one window at a time.** A second start while a pick runs is a 409 naming the
 *    running source: two Edge windows compete for one reader, and the second click
 *    would be a mystery;
 *  - **the pick fills, it does not write** (D-036). The merged text is returned to
 *    the editor and SAVE is the reader's act; a click that rewrote a file would put
 *    D-011's truth under a mouse;
 *  - **the job is never a floating promise.** The async run is caught and recorded
 *    as `failed` with its sentence, and logged — a job that dies in a promise
 *    leaves the page watching `running` forever, which is rule 5 in a new costume;
 *  - **the address is the wall** (rule 20, D-034). Launching a browser on a machine
 *    is a write, and the reading list is loopback's (rule 18), so `/api/pick` is
 *    refused before routing, for every verb, by `readingListAllowed`.
 */

export interface PickJob {
  readonly id: string;
  state: 'running' | 'picked' | 'failed';
  /** The one sentence the CLI prints too. */
  sentence: string;
  messages: string[];
  /** The merged file text, when the pick proved a selector. The editor's new value. */
  text: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PickApiDeps {
  /** `sources/<id>.json`, read as text plus the parsed spec: the editor's own view. */
  readonly specOf: (
    id: string,
  ) => Promise<{ ok: true; spec: SourceSpec; text: string } | { ok: false; message: string }>;
  /**
   * The plain transport, as the poller uses it: the bytes the selector must survive.
   * The url is the one the **window ended on** — the reader may have navigated to a
   * section index — while the spec carries the policy (headers, limits, cadence keys).
   */
  readonly fetchText: (spec: SourceSpec, url: string) => Promise<string>;
  /** The browser tier. The server passes `openPickSession`; a test passes a stub. */
  readonly launch: (options: PickLaunchOptions) => Promise<PickSessionResult>;
  /** The reader's pick is a window; the suite's is headless. */
  readonly headless: boolean;
  readonly budgetMs?: number;
  readonly navTimeoutMs?: number;
  /** `profiles/`, when the source is `profile: true` (rule 17). */
  readonly profilesDir?: string;
  readonly log: (line: string) => void;
  readonly now: () => Date;
}

export interface PickRoutes {
  /** Start a session for a source id. Answers at once; the window is the long part. */
  readonly start: (id: string) => Promise<ApiAnswer>;
  /** The job's report, as the page prints it. */
  readonly status: (id: string) => ApiAnswer;
}

const refused = (status: number, message: string): ApiAnswer => ({
  status,
  body: { ok: false, state: 'idle', sentence: '', messages: [message], text: null },
});

const reported = (job: PickJob, status = 200): ApiAnswer => ({
  status,
  body: {
    ok: job.state !== 'failed',
    state: job.state,
    sentence: job.sentence,
    messages: job.messages,
    text: job.text,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  },
});

/** The patch a proved run writes into the source's fields. */
const patchOf = (run: Extract<PickRun, { ok: true }>): PickPatch => ({
  list: run.outcome.list,
  fields: run.outcome.fields,
  matchCount: run.outcome.matchCount,
  positional: run.outcome.positional,
});

const profileDirOf = (deps: PickApiDeps, spec: SourceSpec): string | undefined => {
  if (deps.profilesDir === undefined || !spec.profile) return undefined;
  return join(deps.profilesDir, spec.id);
};

/**
 * Why this source cannot be picked, in the sentence both drivers print (the route
 * and `pnpm pick`). `null` means it can. One function, so the CLI cannot grow a
 * friendlier version of the same refusal.
 */
export const pickSourceRefusal = (id: string, spec: SourceSpec): string | null => {
  if (spec.kind !== 'html') {
    return `a pick writes an html source's list and fields; '${id}' is '${spec.kind}' and has none to pick`;
  }
  if (spec.list === null) return `'${id}' is a page source: the page is the item (D-028), so there is no list to pick`;
  return null;
};

export const pickRoutes = (deps: PickApiDeps): PickRoutes => {
  const jobs = new Map<string, PickJob>();

  const finish = (job: PickJob, run: PickRun, sourceText: string, label: string, url: string): void => {
    const sentence = describePickRun(run, { url, label });
    job.sentence = sentence;
    if (!run.ok) {
      job.state = 'failed';
      job.messages = [run.detail, ...run.notes];
      job.finishedAt = deps.now().toISOString();
      deps.log(`pick failed for ${job.id}: ${run.stage}/${run.reason}`);
      return;
    }
    const merged = applyPick(sourceText, patchOf(run));
    if (!merged.ok) {
      job.state = 'failed';
      job.messages = [...merged.messages];
      job.finishedAt = deps.now().toISOString();
      deps.log(`pick produced no merge for ${job.id}`);
      return;
    }
    job.state = 'picked';
    job.text = merged.text;
    job.messages = [...run.outcome.notes, ...merged.messages];
    job.finishedAt = deps.now().toISOString();
    deps.log(
      `pick: ${job.id} -> '${run.outcome.list}' (${String(run.outcome.matchCount)} items), the editor holds the merge`,
    );
  };

  const start: PickRoutes['start'] = async (id) => {
    const running = [...jobs.values()].find((job) => job.state === 'running');
    if (running !== undefined) {
      return refused(
        409,
        `a pick window is already open for '${running.id}': one window at a time — finish it (click, or Esc) before starting another`,
      );
    }
    const loaded = await deps.specOf(id);
    if (!loaded.ok) return refused(404, loaded.message);
    const refusal = pickSourceRefusal(id, loaded.spec);
    if (refusal !== null) return refused(400, refusal);

    const job: PickJob = {
      id,
      state: 'running',
      sentence: '',
      messages: [],
      text: null,
      startedAt: deps.now().toISOString(),
      finishedAt: null,
    };
    jobs.set(id, job);

    const profileDir = profileDirOf(deps, loaded.spec);
    const sessionDeps: PickDeps = {
      launch: deps.launch,
      fetchText: (url: string) => deps.fetchText(loaded.spec, url),
      headless: deps.headless,
      ...(profileDir === undefined ? {} : { profileDir }),
      ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
      ...(deps.navTimeoutMs === undefined ? {} : { navTimeoutMs: deps.navTimeoutMs }),
    };

    void runPick({ url: loaded.spec.url, label: loaded.spec.label }, sessionDeps)
      .then((run) => {
        finish(job, run, loaded.text, loaded.spec.label, loaded.spec.url);
      })
      .catch((cause: unknown) => {
        // A throw is a state, not a lost job: the page must stop watching `running`.
        job.state = 'failed';
        job.sentence = `pick for '${id}' ended in an exception: ${cause instanceof Error ? cause.message : String(cause)}`;
        job.messages = ['the window was closed and the source file was not touched'];
        job.finishedAt = deps.now().toISOString();
        deps.log(`pick threw for ${id}`);
      });

    return reported(job, 202);
  };

  const status: PickRoutes['status'] = (id) => {
    const job = jobs.get(id);
    if (job === undefined)
      return refused(404, `no pick has run for '${id}' in this process: start one with POST /api/pick`);
    return reported(job);
  };

  return { start, status };
};

/** The source's file, as the editor sees it: text, plus the parsed spec, or a named refusal. */
export const readSourceForPick = (
  dir: string,
  id: string,
  read: (path: string) => Promise<string>,
  sourcePath: (dir: string, id: string) => string,
): Promise<{ ok: true; spec: SourceSpec; text: string } | { ok: false; message: string }> => {
  const path = sourcePath(dir, id);
  return read(path)
    .then((text) => {
      const parsed = parseSourceJson(text, path);
      return parsed.ok
        ? { ok: true as const, spec: parsed.spec, text }
        : { ok: false as const, message: `${path} does not validate: ${parsed.issue.messages.join('; ')}` };
    })
    .catch((cause: unknown) => ({
      ok: false as const,
      message: `${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    }));
};
