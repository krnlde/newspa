import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { type AppConfig, appConfigSchema, type SourceSpec, sourceSchema } from './schema.ts';

export interface SourceIssue {
  file: string;
  reason: 'unreadable' | 'invalid-json' | 'schema';
  messages: readonly string[];
}

export interface SourceLoadResult {
  sources: SourceSpec[];
  issues: SourceIssue[];
  dir: string;
}

const issueMessages = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

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

/**
 * `sources/*.json` is the only source of truth for definitions. The runtime
 * reads these files on boot and one-way syncs them into SQLite; the web UI
 * writes here (never into the DB), so selector changes are git-visible.
 */
export const loadSources = async (dir: string): Promise<SourceLoadResult> => {
  const sources: SourceSpec[] = [];
  const issues: SourceIssue[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { sources, issues, dir };
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(dir, entry);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (cause) {
      issues.push({
        file: entry,
        reason: 'unreadable',
        messages: [cause instanceof Error ? cause.message : 'cannot read'],
      });
      continue;
    }
    const parsed = parseSourceJson(text, entry);
    if (parsed.ok) sources.push(parsed.spec);
    else issues.push(parsed.issue);
  }

  const seen = new Map<string, string>();
  for (const spec of sources) {
    const previous = seen.get(spec.id);
    if (previous !== undefined) {
      issues.push({
        file: `${previous}, ${spec.id}.json`,
        reason: 'schema',
        messages: [`duplicate source id "${spec.id}"; the second file was ignored`],
      });
    }
    seen.set(spec.id, `${spec.id}.json`);
  }

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

export const sourcePath = (dir: string, spec: SourceSpec): string => path.join(dir, `${spec.id}.json`);

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
  await rm(path.join(dir, `${id}.json`), { force: true });
};
