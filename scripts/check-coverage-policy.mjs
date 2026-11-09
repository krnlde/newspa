#!/usr/bin/env node
/**
 * The coverage gate is only real if every package runs the same policy.
 *
 * `vitest.coverage.json` at the repo root is that policy; each package's
 * `vitest.coverage.ts` reads it and passes it to `test.coverage` (vitest allows
 * coverage only at a **root** config, and a root-level run resolves `include`
 * per project root, so it measured nothing and printed a confident 0% while
 * passing). What can rot is: a package that stops reading the policy, a policy
 * quietly weakened, a `coverage:` key left in a project config (tsc rejects it,
 * so `pnpm typecheck` would fail — it is checked here too, with a clear message).
 * `pnpm check` runs this.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const PACKAGES = [
  'packages/core',
  'packages/config',
  'packages/db',
  'packages/fetch',
  'packages/paper',
  'packages/server',
  'apps/web',
];

const FLOOR = 95;
const METRICS = ['lines', 'functions', 'branches', 'statements'];

const read = (relative) => readFile(join(root, relative), 'utf8');

const problems = [];

const policy = JSON.parse(await read('vitest.coverage.json'));

// The policy itself: a threshold lowered to make a build pass is the failure
// this script exists to catch, so the floor is asserted, not trusted.
for (const metric of METRICS) {
  const value = policy.thresholds?.[metric];
  if (typeof value !== 'number' || value < FLOOR) {
    problems.push(`vitest.coverage.json: thresholds.${metric} is ${JSON.stringify(value)}, must be >= ${FLOOR}`);
  }
}
if (policy.all !== true)
  problems.push('vitest.coverage.json: "all" must be true (files with no tests count as uncovered)');
if (!Array.isArray(policy.include) || !policy.include.every((glob) => glob.startsWith('src/'))) {
  problems.push('vitest.coverage.json: include must be package-relative ("src/**"), never repo-relative');
}

for (const dir of PACKAGES) {
  const config = await read(`${dir}/vitest.coverage.ts`);
  if (!config.includes('vitest.coverage.json')) {
    problems.push(`${dir}/vitest.coverage.ts: does not read vitest.coverage.json`);
  }
  if (!config.includes('new URL(') || !config.includes('import.meta.url')) {
    problems.push(`${dir}/vitest.coverage.ts: must resolve the policy from a module URL, not a cwd-relative path`);
  }
  if (!config.includes('coverage: parsedPolicy as CoverageOptions')) {
    problems.push(`${dir}/vitest.coverage.ts: never passes the policy to test.coverage`);
  }
  // A project config that carries a `coverage:` key is a type error (vitest's
  // project config type omits it), so the split into two configs is load-bearing.
  // Only the key, never the word: the config files' comments explain coverage.
  const project = await read(`${dir}/vitest.config.ts`);
  if (/^\s*coverage:/m.test(project)) {
    problems.push(`${dir}/vitest.config.ts: must not configure coverage (vitest allows it only at a root config)`);
  }
}

if (problems.length > 0) {
  console.error('coverage policy gate:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`coverage policy gate: ${PACKAGES.length} configs read vitest.coverage.json, thresholds >= ${FLOOR}`);
