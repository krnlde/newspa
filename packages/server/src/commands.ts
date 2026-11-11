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
    'not built: the paper has no search box yet. FTS5 exists in `packages/db`; the route and the box are roadmap WP7.',
  pick: 'not built: the picker is the browser tier (roadmap WP6). Write sources/<id>.json in the meantime — that file is the truth (D-011).',
  login:
    'not built: nothing in this repo authenticates anything to anyone (rule 17), and the Edge profile is roadmap WP8. Sources that need it are refused by name, not fetched anonymously.',
  import:
    'not built: it pairs with `export --bundle` (roadmap WP11). Until it exists, restore by reading the bundle with `bundleSchema` and writing the files by hand.',
  'sources:migrate':
    'not built: a permanent redirect self-heals at the first poll (D-030 rung 1), and the reader moves a URL by editing the file, which is where the truth lives (D-011).',
};

/** The argv names that run something: the paper, and the backup rule 18 requires. */
const BUILT: readonly string[] = [START, 'export'];

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
