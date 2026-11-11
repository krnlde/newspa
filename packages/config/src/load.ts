import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { type AppConfig, appConfigSchema, type SourceSpec, sourceSchema } from './schema.ts';

export interface SourceIssue {
  file: string;
  reason: 'unreadable' | 'invalid-json' | 'schema' | 'missing-dir' | 'no-sources';
  messages: readonly string[];
}

export interface SourceLoadResult {
  sources: SourceSpec[];
  issues: SourceIssue[];
  dir: string;
}

const issueMessages = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

/** `ENOENT` is "you have no sources yet"; any other code is a real read failure. */
const errorCodeOf = (cause: unknown): string =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : '';

export const parseSourceJson = (
  text: string,
  file: string,
): { ok: true; spec: SourceSpec } | { ok: false; issue: SourceIssue } => {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    return {
      ok: false,
      issue: { file, reason: 'invalid-json', messages: [cause instanceof Error ? cause.message : 'unparseable'] },
    };
  }
  const parsed = sourceSchema.safeParse(json);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return { ok: false, issue: { file, reason: 'schema', messages: issueMessages(parsed.error) } };
};

/** `ENOENT` is "you have no sources yet"; any other code is a real read failure. */
const missingDirIssue = (dir: string, cause: unknown): SourceIssue => {
  const detail = cause instanceof Error ? cause.message : 'cannot read';
  if (errorCodeOf(cause) !== 'ENOENT') return { file: dir, reason: 'unreadable', messages: [detail] };
  return {
    file: dir,
    reason: 'missing-dir',
    messages: [`no source directory here: ${detail}; copy the examples with pnpm sources:init, or add <id>.json`],
  };
};

const emptyDirIssue = (dir: string): SourceIssue => ({
  file: dir,
  reason: 'no-sources',
  messages: ['the directory exists and holds no .json source: pnpm sources:init copies sources.example/ (D-025)'],
});

/** One file: read, parse, validate. A failure is always an issue, never a skip (rule 5). */
const loadOne = async (
  dir: string,
  entry: string,
): Promise<{ ok: true; spec: SourceSpec } | { ok: false; issue: SourceIssue }> => {
  let text: string;
  try {
    text = await readFile(path.join(dir, entry), 'utf8');
  } catch (cause) {
    return {
      ok: false,
      issue: { file: entry, reason: 'unreadable', messages: [cause instanceof Error ? cause.message : 'cannot read'] },
    };
  }
  const parsed = parseSourceJson(text, entry);
  return parsed.ok ? { ok: true, spec: parsed.spec } : { ok: false, issue: parsed.issue };
};

/** Two files claiming one id: the second is ignored, and that is reported. */
const duplicateIdIssues = (sources: readonly SourceSpec[]): SourceIssue[] => {
  const issues: SourceIssue[] = [];
  const seen = new Set<string>();
  for (const spec of sources) {
    if (seen.has(spec.id)) {
      issues.push({
        file: `${spec.id}.json`,
        reason: 'schema',
        messages: [`duplicate source id "${spec.id}"; the second file was ignored`],
      });
    }
    seen.add(spec.id);
  }
  return issues;
};

/**
 * `sources/*.json` is the only source of truth for definitions. The runtime
 * reads these files on boot and one-way syncs them into SQLite; the web UI
 * writes files, never rows (D-011).
 *
 * The directory is a parameter, and that is what makes D-025 cheap: the reading
 * list is local and gitignored, so **a fresh clone has no source directory at
 * all.** That is the normal first-run state, not an error, and it is reported as
 * an issue rather than answered with an empty list — rule 5. `pnpm sources:init`
 * copies `sources.example/` in.
 */
export const loadSources = async (dir: string): Promise<SourceLoadResult> => {
  const sources: SourceSpec[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    return { sources, issues: [missingDirIssue(dir, cause)], dir };
  }

  const json = entries.filter((entry) => entry.endsWith('.json')).sort();
  if (json.length === 0) return { sources, issues: [emptyDirIssue(dir)], dir };

  const issues: SourceIssue[] = [];
  for (const entry of json) {
    const loaded = await loadOne(dir, entry);
    if (loaded.ok) sources.push(loaded.spec);
    else issues.push(loaded.issue);
  }

  issues.push(...duplicateIdIssues(sources));
  return { sources, issues, dir };
};

export interface AppConfigResult {
  config: AppConfig;
  file: string;
  messages: string[];
}

export const loadAppConfig = async (file: string): Promise<AppConfigResult> => {
  const messages: string[] = [];
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (cause) {
    if (cause instanceof SyntaxError) messages.push(`config: invalid JSON (${cause.message}); using defaults`);
    else messages.push('config: not present; using defaults');
  }
  const parsed = appConfigSchema.safeParse(raw);
  if (parsed.success) return { config: parsed.data, file, messages };
  return { config: appConfigSchema.parse({}), file, messages: [...messages, ...issueMessages(parsed.error)] };
};

const isDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The creating step, and the only place that creates. `sources/` is gitignored
 * (D-025), so a fresh clone has no source directory, and every writer needs one:
 * `writeSource` makes it for itself, and boot needs it to exist before it can
 * report that the directory is empty.
 *
 * Idempotent, and it never touches a file. A non-`ENOENT` stat failure falls
 * through to `mkdir`, which raises the precise error — this swallow cannot
 * become a silent zero.
 *
 * `loadSources` deliberately does **not** call this. Creating a directory inside
 * a reader hides the side effect, and rule 5 wants the louder thing: the paper
 * must *say* it has nothing to print. Boot calls this, then reads, then reports.
 */
export const ensureSourcesDir = async (dir: string): Promise<{ created: boolean }> => {
  if (await isDirectory(dir)) return { created: false };
  await mkdir(dir, { recursive: true });
  return { created: true };
};

/**
 * The one id → file rule: `sources/<id>.json` (D-011: the directory listing **is**
 * the source list). Every route that needs a file from an id asks this, so the rule
 * cannot be spelled twice and drift.
 */
export const sourceFilePath = (dir: string, id: string): string => path.join(dir, `${id}.json`);

export const sourcePath = (dir: string, spec: SourceSpec): string => sourceFilePath(dir, spec.id);

/**
 * Writes the definition file. `matchCount` is included because it is the
 * number that makes selector rot visible at runtime.
 */
export const writeSource = async (dir: string, spec: SourceSpec): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const target = sourcePath(dir, spec);
  await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return target;
};

export const removeSource = async (dir: string, id: string): Promise<void> => {
  const { rm } = await import('node:fs/promises');
  await rm(sourceFilePath(dir, id), { force: true });
};
