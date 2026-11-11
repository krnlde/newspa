/**
 * The process edge: argv, `console`, signals, exit codes. It is the file the root
 * scripts name (`node packages/server/src/cli.ts start`), and it is coverage-excluded
 * for the reason the shared policy gives for `main.tsx` and the browser launches: it
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
import { pathToFileURL } from 'node:url';
import { BundleRefusedError, exportBundle } from './bundleExport.ts';
import { isBuilt, refusalOf, START, unknownCommandLine } from './commands.ts';
import { boot, ROOT } from './start.ts';

const log = (line: string): void => {
  console.log(line);
};

/** The last resorts, printed. A crash that leaves no line is unfindable. */
const installCrashReports = (): void => {
  process.on('unhandledRejection', (reason) => {
    log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  process.on('uncaughtException', (cause) => {
    log(`uncaught exception: ${cause.stack ?? cause.message} — surviving it (architecture.md: the 3am gap is worse)`);
  });
};

/** `start`: the whole product, and the signals that end it cleanly. */
const runStart = async (): Promise<void> => {
  installCrashReports();
  const running = await boot({ root: ROOT, log });
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
    throw cause;
  }
};

const main = async (): Promise<void> => {
  const name = process.argv[2] ?? START;
  if (name === 'export') {
    await runExport(process.argv.slice(3));
    return;
  }
  if (isBuilt(name)) {
    await runStart();
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
