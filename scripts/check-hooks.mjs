import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Fails loudly when the pre-commit hook is not installed.
 *
 * Why this file exists: husky activates itself from a `prepare` lifecycle
 * script, and this workspace sets `ignoreScripts: true` (pnpm-workspace.yaml,
 * rule 8). Measured: `pnpm install` ran no `prepare` at all - `.husky/_` was
 * never created and `core.hooksPath` stayed empty - while `pnpm exec husky` did
 * the job. So on a fresh clone the hook file sits in git, looks installed, and
 * never runs.
 *
 * That is the silent-zero shape rule 5 bans: a guard that protects nothing
 * while looking like it does. The fix is not to weaken the supply-chain rule; it
 * is to make activation explicit (`pnpm hooks:install`) and to make the missing
 * activation a build failure, not a rumour.
 */

const HOOKS_PATH = '.husky/_';
const HUSKY_DIR = fileURLToPath(new URL('../.husky/', import.meta.url));

const currentHooksPath = () => {
  try {
    return execFileSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const problems = [];

if (!existsSync(`${HUSKY_DIR}pre-commit`)) {
  problems.push('.husky/pre-commit is missing from the working tree.');
}

const hooksPath = currentHooksPath();
if (hooksPath !== HOOKS_PATH) {
  problems.push(
    `git core.hooksPath is "${hooksPath || '(unset)'}", expected "${HOOKS_PATH}". ` +
      'The pre-commit gate is NOT running: commits land unguarded and `pnpm check` is the only net.',
  );
}

if (problems.length > 0) {
  console.error('pre-commit hook: NOT ACTIVE\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error('  Fix: pnpm hooks:install\n');
  console.error(
    '  (Why a command and not the `prepare` script: this workspace sets\n' +
      "   ignoreScripts: true, so husky's own lifecycle activation never fires.)\n",
  );
  process.exit(1);
}

console.log(`pre-commit hook: active (core.hooksPath = ${hooksPath})`);
