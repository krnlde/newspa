#!/usr/bin/env node
// Rule #1 of AGENTS.md: no file may exceed 300 lines.
// Every file is counted — source, tests, CSS, JSON, YAML, markdown, scripts.
// The exemptions below are the complete list, and each one is a reason.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_LINES = 300;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.data', '.pnpm', 'coverage', 'profiles', 'tmp']);

// Generated or fetched payloads, not authored code:
//  - pnpm-lock.yaml is written by pnpm.
//  - schemas/ is generated from zod by scripts/generate-schemas.mjs; a JSON
//    Schema for a 3-way discriminated union is 630 lines of `if/then`, and
//    hand-shrinking it would break the drift gate that keeps it honest.
//  - test fixtures are real captured pages (a BBC index is ~370 KB); they are
//    data, and truncating them to satisfy a line cap would destroy the test.
//  - apps/web/dev/state.json is the dev paper: `pnpm seed` writes it out of the
//    fixtures, it is gitignored, and hand-editing it is not a thing one does.
//  - the last pattern is binary, and SQLite's sidecars are in it on purpose:
//    `-wal`/`-shm`/`-journal` are the frames and the shared-memory index next to
//    the exempt `.db`, they only appear **after a run**, and a line cap on
//    authored files cannot mean anything to a write-ahead log. (The gate missed
//    this until `pnpm start` was run in a checked-out tree — 8,467 "lines".)
const EXEMPT_PATTERNS = [
  /(^|[/\\])pnpm-lock\.yaml$/,
  /(^|[/\\])package-lock\.json$/,
  /(^|[/\\])schemas[/\\]/,
  /(^|[/\\])fixtures[/\\]/,
  /(^|[/\\])dev[/\\]state\.json$/,
  /\.(png|jpg|jpeg|webp|ico|db|sqlite3|wasm|gz|zip|woff2?)$/,
  /\.(db|sqlite3)-(wal|shm|journal|hotlock-journal)$/,
];

const isExempt = (relative) => EXEMPT_PATTERNS.some((re) => re.test(relative));

const walk = async (dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    if (!isExempt(path.relative(process.cwd(), full))) files.push(full);
  }
  return files;
};

const root = process.cwd();
const files = await walk(root);
const oversized = [];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > MAX_LINES) oversized.push({ file: path.relative(root, file), lines });
}

if (oversized.length > 0) {
  oversized.sort((a, b) => b.lines - a.lines);
  console.error(`\nNo file may exceed ${MAX_LINES} lines (AGENTS.md rule 1). Split by responsibility:\n`);
  for (const { file, lines } of oversized) console.error(`  ${String(lines).padStart(5)}  ${file}`);
  console.error(`\n${oversized.length} of ${files.length} files are too large.\n`);
  process.exitCode = 1;
} else {
  console.log(`file length: ${files.length} files checked, all <= ${MAX_LINES} lines`);
}
