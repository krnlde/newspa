/**
 * The command decisions, as data (the process edge that reads them is `cli.ts`).
 *
 * A cut command is **named, not deleted**: the root scripts list them, and rule 5
 * is that a silent zero is a bug — `pnpm status` exiting with a module-not-found
 * reads as a broken install, while a line that names the place the answer lives
 * (the paper's health strip, the file the reader edits) is an answer.
 *
 * The strings cite the roadmap work package and, where one applies, the decision
 * that made the cut: a refusal that does not say why is a file the next reader
 * re-adds.
 */
export const START = 'start';

/** The commands, and the reason each is not built. Keyed by argv's name. */
export const CUT: Readonly<Record<string, string>> = {
  status:
    'not built: the paper prints its own health strip. GET /api/state, or open the page — the strip is rule 5 in print.',
  search:
    'not built: the paper has no search box, and none is planned (D-045) — the page is an index, not a search engine. The route and the box were roadmap WP7, retired 2026-11-13.',
  login:
    'not built: nothing in this repo authenticates anything to anyone (rule 17), and the Edge profile is roadmap WP8. Sources that need it are refused by name, not fetched anonymously.',
  import:
    'not built: it pairs with `export --bundle` (roadmap WP11). Until it exists, restore by reading the bundle with `bundleSchema` and writing the files by hand.',
  'sources:migrate':
    'not built: a permanent redirect self-heals at the first poll (D-030 rung 1), and the reader moves a URL by editing the file, which is where the truth lives (D-011).',
};

/** The argv names that run something: the paper, the picker, and the backup rule 18 requires. */
const BUILT: readonly string[] = [START, 'export', 'pick'];

export const isBuilt = (name: string): boolean => BUILT.includes(name);

/** The built commands, in the order worth reading. */
export const BUILT_COMMANDS: readonly string[] = BUILT;

/**
 * The line a cut command prints, or `null` for a name this tool has never heard of
 * (the caller prints the list of what exists then, which is the useful answer).
 */
export const refusalOf = (name: string): string | undefined => CUT[name];

/** The cut commands, in the order worth reading: status first, data safety last. */
export const CUT_COMMANDS: readonly string[] = Object.keys(CUT);

/** What the process edge prints for an unknown name: the built commands, and the cut list. */
export const unknownCommandLine = (name: string): string =>
  `newspa: unknown command "${name}". Built: ${BUILT_COMMANDS.join(', ')}. Not built, and why: ${CUT_COMMANDS.join(', ')}.`;

/**
 * `start`'s argv, as a decision (the process edge prints it, exit 2).
 *
 * `start` takes **no** arguments, and a flag it ignores is not a neutral thing:
 * `server.host` is the access control (D-034), so a reader who types
 * `start --host 0.0.0.0` and gets a running paper that stayed on loopback
 * believes they changed something they did not, and the reader who types
 * `start --port 8788` believes the wall is somewhere else. Silence is the
 * failure; the named answer is the fix. The settings are `config.json`, and
 * that file is the one place they are read from.
 */
export type StartPlan = { readonly ok: true } | { readonly ok: false; readonly message: string };

export const START_USAGE =
  'start takes no arguments: the paper reads config.json (server.host, server.port, scheduler.*, scoring.*), and sources/ is the reading list. D-034: the address is the access control, so it is set in the file, never on a command line.';

export const parseStartArgs = (args: readonly string[]): StartPlan =>
  args.length === 0
    ? { ok: true }
    : {
        ok: false,
        message: `start: unexpected argument${args.length === 1 ? '' : 's'}: ${args.join(' ')}.\n  ${START_USAGE}`,
      };

/**
 * The line a built command prints when it **cannot run at all** — exit 1, with the
 * reason, and none of the running loop's promises.
 *
 * Measured on this machine: a `pnpm start` killed with the process tree left the
 * `db_lock` claim behind, and the next `pnpm server` answered its own
 * `DatabaseLockedError` as an *uncaught exception* — a stack ending
 * "— surviving it", from a run that had no server, no scheduler and nothing to
 * survive. That is rule 5's inverse: not a silent zero, but a loud lie. A boot that
 * cannot boot is named and exits; the last-resort handlers are for a loop that is
 * already running.
 */
export const failureLine = (command: string, cause: unknown): string =>
  `${command} failed: ${cause instanceof Error ? cause.message || cause.name : String(cause)} — not starting`;

/**
 * `pick`'s argv, as a decision (WP6, D-036). The process edge runs it; this is what
 * it decided, so the refusals are testable on a machine with no browser.
 *
 * Two targets, and the difference is what a write can mean:
 *
 *  - `pick -- <url>`: a page the reading list does not know. The pick prints the
 *    selector it proved and **writes nothing** — there is no file, and inventing one
 *    from a click is not this tool's call (D-011: the file is the truth, and the
 *    reader wrote it);
 *  - `pick -- --id <source> [--write]`: a source the reader already has. The window
 *    opens at the file's own url, with the file's own headers, limits and
 *    `profile: true` fact, and `--write` merges the proved selectors into that file
 *    through `applyPick` — which re-validates the result with the loader's parser.
 *
 * `--write` is refused without `--id` for the same reason: a bare url has no file to
 * merge into, and the honest answer is the sentence plus the keys to paste.
 */
export type PickPlan =
  | { readonly ok: true; readonly mode: 'url'; readonly url: string }
  | { readonly ok: true; readonly mode: 'source'; readonly id: string; readonly write: boolean }
  | { readonly ok: false; readonly message: string };

export const PICK_USAGE =
  'pick: `pnpm pick -- <url>` proves a selector on a page and prints it; `pnpm pick -- --id <source> [--write]` does the same for a source file, and --write merges the result into it (D-036).';

const refusedPick = (message: string): PickPlan => ({ ok: false, message: `${message}\n  ${PICK_USAGE}` });

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/** The argv, read one token at a time: a recursion, so each branch is one fact. */
interface PickTargets {
  readonly url: string | null;
  readonly id: string | null;
  readonly write: boolean;
}

type Collected = ({ readonly ok: true } & PickTargets) | { readonly ok: false; readonly why: string };

const step = (args: readonly string[], at: number, acc: PickTargets): Collected => {
  const arg = args[at];
  if (arg === undefined) return { ok: true, ...acc };
  if (arg === '--write') {
    return acc.write ? { ok: false, why: 'pick: --write given twice' } : step(args, at + 1, { ...acc, write: true });
  }
  if (arg === '--id') {
    const value = args[at + 1];
    if (value === undefined || value.startsWith('-')) return { ok: false, why: 'pick: --id needs a source id' };
    if (acc.id !== null) return { ok: false, why: 'pick: --id given twice' };
    return step(args, at + 2, { ...acc, id: value });
  }
  if (arg.startsWith('-')) return { ok: false, why: `pick: unknown flag '${arg}'` };
  if (acc.url !== null) return { ok: false, why: `pick: two urls given ('${acc.url}' and '${arg}')` };
  return step(args, at + 1, { ...acc, url: arg });
};

/** The rules, once the tokens are in hand. Each one is a sentence the reader can act on. */
const decide = (targets: PickTargets): PickPlan => {
  const { url, id, write } = targets;
  if (url !== null && id !== null) return refusedPick('pick: one target — a url, or --id, not both');
  if (url === null && id === null) return refusedPick('pick: nothing to pick');
  if (id === null && write) return refusedPick('pick: --write needs --id: a bare url has no source file to merge into');
  if (url !== null && !isHttpUrl(url)) return refusedPick(`pick: '${url}' is not an http(s) address`);
  if (id !== null && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    return refusedPick(`pick: '${id}' is not a source id (lowercase kebab-case, as sources/<id>.json)`);
  }
  return url !== null ? { ok: true, mode: 'url', url } : { ok: true, mode: 'source', id: id ?? '', write };
};

/** One target, no unknown flags, and `--write` only where a file exists to write. */
export const parsePickArgs = (args: readonly string[]): PickPlan => {
  const collected = step(args, 0, { url: null, id: null, write: false });
  return collected.ok
    ? decide({ url: collected.url, id: collected.id, write: collected.write })
    : refusedPick(collected.why);
};
