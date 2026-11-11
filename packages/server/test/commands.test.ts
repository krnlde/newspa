/**
 * The commands, as data: what runs, what refuses, and the gate that keeps the two
 * in step with the root `package.json`.
 *
 * The gate is the point. `package.json` names `cli.ts` for eight scripts, and the
 * MVP builds two commands; the rule that makes that honest is that **every** command
 * those scripts run has an answer — built, or a line that says where the answer lives
 * instead. A script that prints a module-not-found is rule 5's silent zero, and this
 * test is what stops the scripts and the commands drifting apart.
 *
 * The gate reads the **argv command** out of the script body, not the script's key:
 * `pnpm server` runs `cli.ts start`, and it is `start` that needs an answer. The keys
 * are pinned separately, because a new verb is a decision worth naming.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUILT_COMMANDS,
  CUT,
  CUT_COMMANDS,
  failureLine,
  isBuilt,
  refusalOf,
  START,
  unknownCommandLine,
} from '../src/commands.ts';

const scriptsOf = (): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts;
};

interface CliScript {
  readonly script: string;
  readonly command: string;
  readonly run: string;
}

/** Every root script that runs `cli.ts`, with the command its argv names. */
const cliScripts = (): CliScript[] => {
  const found: CliScript[] = [];
  for (const [script, run] of Object.entries(scriptsOf())) {
    const argv = /packages\/server\/src\/cli\.ts\s+(\S+)/.exec(run);
    const command = argv?.[1];
    if (command !== undefined) found.push({ script, command, run });
  }
  return found;
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
  it('every command a root script runs has an answer: built, or a named refusal', () => {
    const scripts = cliScripts();
    expect(scripts.length).toBeGreaterThan(1);
    for (const { script, command } of scripts) {
      expect(
        isBuilt(command) || refusalOf(command) !== undefined,
        `pnpm ${script} runs "${command}", which has no answer`,
      ).toBe(true);
    }
  });

  it('the scripts that name cli.ts are the pinned list, so a new verb is a decision', () => {
    expect(
      cliScripts()
        .map((entry) => entry.script)
        .sort(),
    ).toEqual(['export', 'import', 'login', 'pick', 'search', 'server', 'start', 'status'].sort());
  });

  it('the run verbs are what the docs say: `start` builds, `server` does not, `ui` proxies', () => {
    const scripts = scriptsOf();
    // The product entry: one command, and the page it serves exists. `&&` is
    // deliberate — pnpm's `prestart` hook is not the semantics to lean on.
    expect(scripts['start']).toContain('pnpm build');
    expect(scripts['start']).toContain('cli.ts start');
    // The low-level process, fast, no build: it answers the API and serves `dist`
    // only if it exists (the missing-build answer is a named 404, not a blank page).
    expect(scripts['server']).toBe('node packages/server/src/cli.ts start');
    // The dev pair: Vite against the live server (`--mode server`), never a LAN bind.
    expect(scripts['ui']).toContain('--mode server');
    expect(scripts['ui']).toContain('newspa-web');
    expect(scripts['ui']).not.toContain('build');
    expect(scripts['dev']).toBe('pnpm -r --parallel --color run dev');
  });

  it('an unknown command is answered with the built ones and the cut list', () => {
    const line = unknownCommandLine('frobnicate');
    expect(line).toContain('frobnicate');
    expect(line).toContain(START);
    expect(line).toContain('sources:migrate');
  });
});

describe('a command that cannot run at all', () => {
  it('is named with its reason and exits, and never promises to survive', () => {
    // The measured case: a killed process left the `db_lock` claim, and the next
    // start answered its own DatabaseLockedError as an "uncaught exception …
    // surviving it" — about a loop that had not started. Rule 5's inverse: not a
    // silent zero, a loud lie.
    const cause = new Error('another process holds this database (claim "ea2309ab")');
    const line = failureLine('start', cause);
    expect(line).toContain('start failed');
    expect(line).toContain('another process holds this database');
    expect(line).toContain('not starting');
    expect(line).not.toContain('surviving');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('says the same thing for a cause that is not an Error, and for an Error with no message', () => {
    expect(failureLine('export --bundle', 'disk gone')).toContain('export --bundle failed: disk gone');
    expect(failureLine('start', new Error())).toContain('start failed: Error');
  });
});
