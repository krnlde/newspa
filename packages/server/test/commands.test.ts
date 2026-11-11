/**
 * The commands, as data: what runs, what refuses, and the gate that keeps the two
 * in step with the root `package.json`.
 *
 * The gate is the point. `package.json` names `cli.ts` for seven commands, and the
 * MVP builds one of them; the rule that makes that honest is that **every** name in
 * the scripts has an answer — built, or a line that says where the answer lives
 * instead. A script that prints a module-not-found is rule 5's silent zero, and this
 * test is what stops the scripts and the commands drifting apart.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_COMMANDS, CUT, CUT_COMMANDS, isBuilt, refusalOf, START, unknownCommandLine } from '../src/commands.ts';

const cliScripts = (): string[] => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return Object.entries(manifest.scripts)
    .filter(([, run]) => run.includes('packages/server/src/cli.ts'))
    .map(([name]) => name);
};

describe('the built commands', () => {
  it('are `start` and `export`, and argv defaults to `start`', () => {
    expect(START).toBe('start');
    expect(BUILT_COMMANDS).toEqual(['start', 'export']);
    expect(isBuilt('start')).toBe(true);
    expect(isBuilt('export')).toBe(true);
    expect(isBuilt('status')).toBe(false);
    expect(isBuilt('')).toBe(false);
    expect(isBuilt('Start')).toBe(false);
  });
});

describe('the cut commands', () => {
  it('are the named list, so a new script needs a decision recorded here', () => {
    expect(CUT_COMMANDS).toEqual(['status', 'search', 'pick', 'login', 'import', 'sources:migrate']);
  });

  it('every refusal names where the answer lives, not just that it is missing', () => {
    for (const [name, line] of Object.entries(CUT)) {
      expect(line, name).toMatch(/roadmap WP\d+|rule \d+|D-\d{3}|\/api\/state|sources\/|FTS5|bundle/);
    }
  });

  it('`export` is built, because rule 18 makes it the reading list’s only backup', () => {
    expect(refusalOf('export')).toBeUndefined();
    expect(refusalOf('login')).toContain('rule 17');
    expect(refusalOf('sources:migrate')).toContain('D-011');
    expect(refusalOf('import')).toContain('bundle');
    expect(refusalOf('nope')).toBeUndefined();
  });
});

describe('the scripts and the commands cannot drift', () => {
  it('every root script that names cli.ts has an answer: built, or a named refusal', () => {
    const names = cliScripts();
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      expect(isBuilt(name) || refusalOf(name) !== undefined, `pnpm ${name} has no answer`).toBe(true);
    }
  });

  it('an unknown command is answered with the built one and the cut list', () => {
    const line = unknownCommandLine('frobnicate');
    expect(line).toContain('frobnicate');
    expect(line).toContain(START);
    expect(line).toContain('sources:migrate');
  });
});
