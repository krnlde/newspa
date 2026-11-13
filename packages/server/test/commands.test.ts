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
  PICK_USAGE,
  type PickPlan,
  parsePickArgs,
  parseStartArgs,
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
  it('are `start`, `export` and `pick`, and argv defaults to `start`', () => {
    expect(START).toBe('start');
    expect(BUILT_COMMANDS).toEqual(['start', 'export', 'pick']);
    expect(isBuilt('start')).toBe(true);
    expect(isBuilt('export')).toBe(true);
    expect(isBuilt('pick')).toBe(true);
    expect(isBuilt('status')).toBe(false);
    expect(isBuilt('')).toBe(false);
    expect(isBuilt('Start')).toBe(false);
  });
});

describe('the cut commands', () => {
  it('are the named list, so a new script needs a decision recorded here', () => {
    expect(CUT_COMMANDS).toEqual(['status', 'search', 'login', 'import', 'sources:migrate']);
  });

  it('every refusal names where the answer lives, not just that it is missing', () => {
    for (const [name, line] of Object.entries(CUT)) {
      expect(line, name).toMatch(/roadmap WP\d+|rule \d+|D-\d{3}|\/api\/state|sources\/|bundle/);
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

describe('`pick`’s argv (WP6, D-036)', () => {
  const okPlan = (args: readonly string[]): Extract<PickPlan, { ok: true }> => {
    const plan = parsePickArgs(args);
    if (!plan.ok) throw new Error(`refused: ${plan.message}`);
    return plan;
  };

  it('accepts a bare url, a source id, and an id with --write, in any flag order', () => {
    expect(okPlan(['https://example.invalid/world'])).toEqual({
      ok: true,
      mode: 'url',
      url: 'https://example.invalid/world',
    });
    expect(okPlan(['--id', 'bbc'])).toEqual({ ok: true, mode: 'source', id: 'bbc', write: false });
    expect(okPlan(['--write', '--id', 'bbc'])).toEqual({ ok: true, mode: 'source', id: 'bbc', write: true });
    expect(okPlan(['--id', 'bbc', '--write'])).toEqual({ ok: true, mode: 'source', id: 'bbc', write: true });
  });

  it('refuses a bare url with --write: there is no file to merge into, and the tool does not invent one (D-011)', () => {
    const plan = parsePickArgs(['https://example.invalid/world', '--write']);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain('--write needs --id');
  });

  it('refuses a target that is not one, in words that say what to type', () => {
    for (const args of [
      [],
      ['--id'],
      ['--id', 'BBC'],
      ['ftp://example.invalid/world'],
      ['world.html'],
      ['--nope'],
      ['https://a.invalid/x', 'https://b.invalid/y'],
      ['https://a.invalid/x', '--id', 'bbc'],
      ['--id', 'bbc', '--id', 'guardian'],
      ['--write', '--write'],
    ]) {
      const plan = parsePickArgs(args);
      expect(plan.ok, args.join(' ')).toBe(false);
      if (plan.ok) continue;
      expect(plan.message, args.join(' ')).toContain('pick');
      // Rule 5: every refusal prints the usage, so the reader never guesses the shape.
      expect(plan.message, args.join(' ')).toContain(PICK_USAGE.slice(0, 24));
    }
  });

  it('refuses an id that is not a file name, because the id is the file (D-011)', () => {
    const plan = parsePickArgs(['--id', '../../etc/passwd']);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain('kebab-case');
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

/**
 * `start` takes no argv, and this is the decision the process edge prints (exit 2).
 * The reason is D-034, not tidiness: `server.host` is the access control, so a
 * `start --host 0.0.0.0` that runs and stays on loopback is a reader who believes
 * they opened the paper to the household, and `--port` is a reader who believes the
 * wall is on another number. The settings are `config.json`, and the flag has to be
 * answered, not ignored.
 */
describe('`start` argv', () => {
  it('runs on no arguments', () => {
    expect(parseStartArgs([])).toEqual({ ok: true });
  });

  it('refuses one argument by name, and says where the setting lives', () => {
    const plan = parseStartArgs(['--host=0.0.0.0']);
    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error('unreachable: an argument was accepted');
    expect(plan.message).toContain('--host=0.0.0.0');
    expect(plan.message).toContain('config.json');
    expect(plan.message).toContain('server.host');
  });

  it('refuses several, and says so in the plural', () => {
    const plan = parseStartArgs(['--port', '8788']);
    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error('unreachable: arguments were accepted');
    expect(plan.message).toContain('unexpected arguments: --port 8788');
  });

  it('does not treat a path as a working directory to change', () => {
    // The shape that used to be silently ignored: a root given on the command
    // line, which the boot takes from `ROOT`, the module's own location.
    const plan = parseStartArgs(['C:/somewhere/else']);
    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error('unreachable: a root was accepted');
    expect(plan.message).toContain('C:/somewhere/else');
  });
});
