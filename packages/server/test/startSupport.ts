/**
 * The boot harness, shared by the two files that run `boot`: `start.test.ts`
 * (the acceptance list) and `startLock.test.ts` (the database claim).
 *
 * A temp root, a loopback bind on port 0, no scheduler, one injected instant.
 * The instant is not decoration: `start.ts` reads the clock from the deps bag,
 * so a boot that runs at `T0` writes a plan a test can assert on (the cadence
 * boundary) and a claim whose `taken_at` a test can name. Port 0 is the same
 * idea for the socket: two test files bind without reserving a port.
 *
 * Nothing here asserts, and nothing here is faked: a real `node:http` bind, a
 * real SQLite file under `data/`, real source files. The roots are left in
 * `tmpdir()` for the OS to collect — same as `httpSupport.ts`'s temp `dist` —
 * because `mkdtemp` guarantees no two runs collide and the claim is per-file.
 *
 * `T0` is 2026-11-09, two days in the past: a boot that stamps a claim with it
 * leaves a row that is **already older than the stale window** when the next
 * launch reads it with a real clock, which is the fact `startLock.test.ts`
 * needs to separate the age rule from the liveness proof.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BootDeps, boot } from '../src/start.ts';

/** A root that is empty apart from what `boot` itself creates. */
export const tempRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), 'newspa-boot-'));

/** The fixed instant every boot in these files runs at, so a plan is assertable. */
export const T0 = new Date('2026-11-09T10:00:00Z');

/** A config file, a source file: written through the same shape `boot` reads. */
export const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const base = (port: number): string => `http://127.0.0.1:${String(port)}`;

/** Boot with a loopback bind and no scheduler, and always close what booted. */
export const bootOnce = async (
  root: string,
  over: Partial<BootDeps> = {},
): Promise<{ logs: string[]; running: Awaited<ReturnType<typeof boot>> }> => {
  const logs: string[] = [];
  const running = await boot({
    root,
    log: (line) => {
      logs.push(line);
    },
    port: 0,
    host: '127.0.0.1',
    schedule: false,
    now: () => T0,
    ...over,
  });
  return { logs, running };
};

/**
 * A boot that is expected to be refused: the logs are the assertion, so they are
 * collected before `boot` throws, and the cause comes back for the caller to
 * name. `null` means the boot was **not** refused, which is a failing test with
 * a running server to clean up.
 */
export const bootRefusal = async (
  root: string,
  over: Partial<BootDeps> = {},
): Promise<{ logs: string[]; cause: unknown; running: Awaited<ReturnType<typeof boot>> | null }> => {
  const logs: string[] = [];
  try {
    const running = await boot({
      root,
      log: (line) => {
        logs.push(line);
      },
      port: 0,
      host: '127.0.0.1',
      schedule: false,
      now: () => T0,
      ...over,
    });
    return { logs, cause: null, running };
  } catch (cause) {
    return { logs, cause, running: null };
  }
};
