import { readFile } from 'node:fs/promises';
import { applyPick, parseSourceJson, type SourceSpec, sourceFilePath, writeSource } from 'newspa-config';
import { describePickRun, type PickLaunchOptions, type PickRun, type PickSessionResult, runPick } from 'newspa-fetch';
import type { PickPlan } from './commands.ts';
import { pickSourceRefusal, readSourceForPick } from './pickApi.ts';

/**
 * `pnpm pick`, as a function of its deps (WP6, D-036).
 *
 * `cli.ts` is the process edge and prints what this returns; the run, the merge and
 * the write live here, where they are testable — the rule the pre-commit floor runs
 * by (rule 16: a browser cannot be in the gate, and neither can a mouse). The
 * injected `launch` is what makes that true: the suite passes a stub window that
 * reports a real fingerprint against a real page, and the machine that runs the gate
 * never opens a browser.
 *
 * Three rules the return shape carries:
 *
 *  - **`lines` is the whole answer.** The sentence is `describePickRun`'s, so the CLI
 *    and the page print one story; nothing here paraphrases it.
 *  - **a pick writes only when `--write` said so.** D-011: `sources/*.json` is the
 *    truth, and the page's editor (SAVE is the reader's act) is the normal way in.
 *    The CLI is the way in from a terminal, and it says which file it wrote.
 *  - **a pick of a bare url writes nothing, ever.** There is no file to merge into,
 *    and a tool that invented one from a click would be authoring the reader's
 *    reading list behind their back.
 */

export interface PickCliDeps {
  /** The watchlist directory (`sources/`, gitignored, rule 18). */
  readonly dir: string;
  /** The browser tier. Real Edge for a reader; a stub window in the suite. */
  readonly launch: (options: PickLaunchOptions) => Promise<PickSessionResult>;
  readonly fetchText: (spec: SourceSpec, url: string) => Promise<string>;
  /** The writer. The real one is `writeSource`; a test passes a recorder. */
  readonly write?: (dir: string, spec: SourceSpec) => Promise<string>;
  readonly profilesDir?: string;
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

export interface PickCliResult {
  readonly ok: boolean;
  readonly lines: string[];
}

const readText = (path: string): Promise<string> => readFile(path, 'utf8');

/** A source file the reader has. Text, spec, and the named refusals the route uses too. */
const targetOf = async (
  plan: Extract<PickPlan, { ok: true; mode: 'source' }>,
  deps: PickCliDeps,
): Promise<{ ok: true; spec: SourceSpec; text: string } | { ok: false; lines: string[] }> => {
  const loaded = await readSourceForPick(deps.dir, plan.id, readText, sourceFilePath);
  if (!loaded.ok) return { ok: false, lines: [loaded.message] };
  const refusal = pickSourceRefusal(plan.id, loaded.spec);
  return refusal === null ? { ok: true, spec: loaded.spec, text: loaded.text } : { ok: false, lines: [refusal] };
};

/** A page the reading list does not know: a spec built by the schema, so the defaults are the schema's. */
const specOfUrl = (url: string): SourceSpec | null => {
  const text = JSON.stringify({
    id: 'pick-target',
    label: 'pick target',
    url,
    kind: 'html',
    list: 'li',
    fields: { title: 'a' },
  });
  const parsed = parseSourceJson(text, '(pick)');
  return parsed.ok ? parsed.spec : null;
};

const patchOf = (run: Extract<PickRun, { ok: true }>) => ({
  list: run.outcome.list,
  fields: run.outcome.fields,
  matchCount: run.outcome.matchCount,
  positional: run.outcome.positional,
});

/** The keys, spelled for pasting into the editor: what a bare-url pick leaves behind. */
const pasteLines = (run: Extract<PickRun, { ok: true }>): string[] => [
  '  nothing was written: a bare url has no source file. The keys to put in one:',
  `  "list": ${JSON.stringify(run.outcome.list)},`,
  `  "fields": ${JSON.stringify(run.outcome.fields)},`,
  `  "matchCount": ${String(run.outcome.matchCount)}`,
];

const mergeAndWrite = async (
  plan: Extract<PickPlan, { ok: true; mode: 'source' }>,
  run: Extract<PickRun, { ok: true }>,
  text: string,
  deps: PickCliDeps,
): Promise<PickCliResult> => {
  const merged = applyPick(text, patchOf(run));
  if (!merged.ok) return { ok: false, lines: [...merged.messages, describePickRun(run, { url: plan.id })] };
  if (!plan.write) {
    return {
      ok: true,
      lines: [
        ...run.outcome.notes,
        ...merged.messages,
        `  add --write to put that into sources/${plan.id}.json, or paste it into the editor on the page`,
      ],
    };
  }
  const parsed = parseSourceJson(merged.text, `sources/${plan.id}.json`);
  if (!parsed.ok) return { ok: false, lines: ['the merged text does not validate: the file was not written'] };
  const path = await (deps.write ?? writeSource)(deps.dir, parsed.spec);
  return { ok: true, lines: [...merged.messages, `wrote ${path}`] };
};

export const runPickCommand = async (plan: PickPlan, deps: PickCliDeps): Promise<PickCliResult> => {
  if (!plan.ok) return { ok: false, lines: [plan.message] };
  const target =
    plan.mode === 'source' ? await targetOf(plan, deps) : { ok: true as const, spec: specOfUrl(plan.url), text: '' };
  if (!target.ok) return target;
  const spec = target.spec;
  if (spec === null) return { ok: false, lines: ['the pick target has no source definition: the schema refused it'] };

  const profileDir = profileDirOf(plan, spec, deps.profilesDir);
  const run = await runPick(
    { url: spec.url, label: spec.label },
    {
      launch: deps.launch,
      fetchText: (url) => deps.fetchText(spec, url),
      headless: false,
      ...(profileDir === undefined ? {} : { profileDir }),
    },
  );

  const sentence = describePickRun(run, { url: spec.url, label: spec.label });
  if (!run.ok) return { ok: false, lines: [sentence, ...run.notes] };
  if (plan.mode === 'url') return { ok: true, lines: [sentence, ...run.outcome.notes, ...pasteLines(run)] };
  const written = await mergeAndWrite(plan, run, target.text, deps);
  return { ok: written.ok, lines: [sentence, ...written.lines] };
};

/** The persistent profile is per source (rule 17), so a bare url never gets one. */
const profileDirOf = (
  plan: Extract<PickPlan, { ok: true }>,
  spec: SourceSpec,
  profilesDir: string | undefined,
): string | undefined => {
  if (plan.mode !== 'source' || !spec.profile || profilesDir === undefined) return undefined;
  return `${profilesDir}/${plan.id}`;
};
