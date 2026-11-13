/**
 * The process edge: argv, `console`, signals, exit codes. It is the file the root
 * scripts name — `start` (the product, which builds first) and `server` (the process
 * alone) both run `cli.ts start` — and it is coverage-excluded for the reason the
 * shared policy gives for `main.tsx` and the browser launches: it
 * touches the process. What is testable about it is the **decision**, which lives in
 * `commands.ts` where a test can reach it.
 *
 * Two commands are built: `start` (the paper) and `export --bundle` (rule 18's
 * backup of the gitignored reading list). The rest are answered by name, each with
 * the place the answer lives instead (roadmap WP5) — a `pnpm status` that dies with a
 * module-not-found reads as a broken install, and rule 5 is that a silent zero is a
 * bug. An unknown name exits 2, a cut command exits 1: the difference is what a shell
 * can branch on.
 *
 * No flags, no subcommand tree, no help text: `newspa` is a personal paper, and the
 * reader's interface to it is the page.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPickSession } from 'newspa-fetch';
import { BundleRefusedError, exportBundle } from './bundleExport.ts';
import {
  failureLine,
  isBuilt,
  parsePickArgs,
  parseStartArgs,
  refusalOf,
  START,
  unknownCommandLine,
} from './commands.ts';
import { channelsOf, createLogger } from './logger.ts';
import { runPickCommand } from './pickCli.ts';
import { pickTextFetcher } from './pickTransport.ts';
import { boot, ROOT } from './start.ts';

/**
 * The process's log (D-046): pino's levels, a clock on every line, and the loudness
 * `config.json` names (`server.logLevel`, set once the config is read). A terminal
 * gets `14:33:08 info …`; a redirect gets JSON lines. The words on a poll's line are
 * the database's own (`snapshots.outcome`), so the terminal and the row agree.
 */
const { log, debug, setLevel } = channelsOf(createLogger('info'));

/** The last resorts, printed. A crash that leaves no line is unfindable. */
const installCrashReports = (): void => {
  process.on('unhandledRejection', (reason) => {
    log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  process.on('uncaughtException', (cause) => {
    log(`uncaught exception: ${cause.stack ?? cause.message} — surviving it (architecture.md: the 3am gap is worse)`);
  });
};

/**
 * `start`: the whole product, and the signals that end it cleanly.
 *
 * The argv is checked **before** anything opens: `start` takes no arguments, and
 * the check has to come first because a boot that runs while a flag goes
 * unread is the lie `commands.ts: parseStartArgs` names (`config.json` is where
 * the address and the port live, D-034).
 *
 * The last-resort handlers are installed **after** the boot succeeds, and a boot
 * failure exits with a line (`commands.ts: failureLine`): "surviving it" is a
 * promise about a loop that does not exist yet, and saying it about a run that never
 * opened its database is a lie with a stack attached.
 */
const runStart = async (args: readonly string[]): Promise<void> => {
  const plan = parseStartArgs(args);
  if (!plan.ok) {
    log(plan.message);
    process.exit(2);
  }
  let running: Awaited<ReturnType<typeof boot>>;
  try {
    running = await boot({ root: ROOT, log, debug, setLevel });
  } catch (cause) {
    log(failureLine('start', cause));
    process.exit(1);
  }
  installCrashReports();
  const shutdown = (signal: string): void => {
    log(`${signal}: stopping the scheduler, closing the streams`);
    void running.close().then(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

/**
 * `export --bundle`: the reading list and the config, in one private file
 * (rule 18). A refusal is printed with every issue line and exits 1: a backup that
 * dropped a source is worse than no backup, and the reader has to be told which file
 * stopped it.
 */
const runExport = async (args: readonly string[]): Promise<void> => {
  const target = args.find((arg) => !arg.startsWith('-'));
  if (args.length > 0 && !args.includes('--bundle')) {
    log(
      `export: the only format built is --bundle (the reading list and the config, rule 18). Watchlist and OPML are roadmap WP11. Got: ${args.join(' ')}`,
    );
    process.exit(1);
  }
  try {
    const result = await exportBundle(ROOT, {
      now: () => new Date(),
      ...(target === undefined ? {} : { target }),
    });
    for (const message of result.messages) log(message);
    log(
      `bundle: ${String(result.sources)} sources → ${result.file} (${String(result.bytes)} bytes, validated by bundleSchema)`,
    );
    log(
      '  it is gitignored, because it is your reading list: keep a copy somewhere that is not this machine (rule 18).',
    );
    process.exit(0);
  } catch (cause) {
    if (cause instanceof BundleRefusedError) {
      log(`${cause.message} — no file was written:`);
      for (const issue of cause.issues) log(`  ${issue}`);
      process.exit(1);
    }
    log(failureLine('export --bundle', cause));
    process.exit(1);
  }
};

/**
 * `pick`: the browser tier (WP6, D-036). A window opens **on this machine**, the
 * reader clicks, and the sentence `pnpm pick` prints is the same one the page prints.
 *
 * No database and no boot: a pick needs the source file and the transport, and that
 * is all. So it runs while the server runs, with no `db_lock` to fight over, and it
 * writes a source file only when `--write` said so — the page's editor (SAVE is the
 * reader's act) is the normal way in.
 */
const runPick = async (args: readonly string[]): Promise<void> => {
  const plan = parsePickArgs(args);
  if (!plan.ok) {
    log(plan.message);
    process.exit(1);
  }
  log('pick: opening a browser window on this machine — click the item, ↑/↓ to step to its card, Esc to stop');
  const result = await runPickCommand(plan, {
    dir: join(ROOT, 'sources'),
    launch: openPickSession,
    fetchText: pickTextFetcher({ now: () => new Date(), fetch: globalThis.fetch }),
    profilesDir: join(ROOT, 'profiles'),
  });
  for (const line of result.lines) log(line);
  process.exit(result.ok ? 0 : 1);
};

const main = async (): Promise<void> => {
  const name = process.argv[2] ?? START;
  if (name === 'export') {
    await runExport(process.argv.slice(3));
    return;
  }
  if (name === 'pick') {
    await runPick(process.argv.slice(3));
    return;
  }
  if (isBuilt(name)) {
    await runStart(process.argv.slice(3));
    return;
  }
  const refusal = refusalOf(name);
  if (refusal === undefined) {
    log(unknownCommandLine(name));
    process.exit(2);
  }
  log(`${name}: ${refusal}`);
  process.exit(1);
};

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  await main();
}
