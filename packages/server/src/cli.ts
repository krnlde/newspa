/**
 * The process edge: argv, `console`, signals, exit codes. It is the file the root
 * scripts name (`node packages/server/src/cli.ts start`), and it is coverage-excluded
 * for the reason the shared policy gives for `main.tsx` and the browser launches: it
 * touches the process. What is testable about it is the **decision**, which lives in
 * `commands.ts` where a test can reach it.
 *
 * One command is built: `start`. The rest are answered by name, each with the place
 * the answer lives instead (roadmap WP5) — a `pnpm status` that dies with a
 * module-not-found reads as a broken install, and rule 5 is that a silent zero is a
 * bug. An unknown name exits 2, a cut command exits 1: the difference is what a shell
 * can branch on.
 *
 * No flags, no subcommand tree, no help text: `newspa` is a personal paper, and the
 * reader's interface to it is the page.
 */
import { pathToFileURL } from 'node:url';
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

const main = async (): Promise<void> => {
  const name = process.argv[2] ?? START;
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
