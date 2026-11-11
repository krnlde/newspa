/**
 * The boot (WP5, MVP): `boot({ root })` against a **temp tree** — a temp `config.json`,
 * a temp `sources/`, a temp `data/newspa.db` — and a real HTTP bind on port 0.
 *
 * This is the acceptance the roadmap asks for, run offline: the entry point creates
 * the directory it needs, reports what it read, refuses a second process on the
 * database claim, upserts the watchlist, serves a paper that parses on core's
 * schema, and starts a scheduler that polls. No network: the poll is a stub, so the
 * boot's own behaviour is what is under test.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceSpec } from 'newspa-config';
import { stateResponseSchema } from 'newspa-core';
import { DatabaseLockedError } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { type BootDeps, boot } from '../src/start.ts';
import { fixture, okResponse } from './pollSupport.ts';
import { aResult } from './schedulerSupport.ts';
import { anRssSpec } from './support.ts';

const tempRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), 'newspa-boot-'));

/** The fixed instant every boot in this file runs at, so a plan is assertable. */
const T0 = new Date('2026-11-09T10:00:00Z');

const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const base = (port: number): string => `http://127.0.0.1:${String(port)}`;

/** Boot with a loopback bind and no scheduler, and always close what booted. */
const bootOnce = async (
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

describe('the boot', () => {
  it('creates the sources directory it needs, and says so (D-025)', async () => {
    const root = await tempRoot();
    const { logs, running } = await bootOnce(root);
    expect(logs.join('\n')).toContain('created the sources directory');
    expect(logs.join('\n')).toContain('the paper will be empty');
    await running.close();
  });

  it('reports a config that is not there, and boots on the defaults', async () => {
    const root = await tempRoot();
    const { logs, running } = await bootOnce(root);
    expect(logs.join('\n')).toContain('not present; using defaults');
    const state = stateResponseSchema.parse(await (await fetch(`${base(running.port)}/api/state`)).json());
    expect(state.masthead.name).toBe('The Daily');
    await running.close();
  });

  it('serves a paper built from the watchlist in the temp tree', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'config.json'), { masthead: { name: 'The Temp Ledger' } });
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec());
    const { logs, running } = await bootOnce(root);
    expect(logs.join('\n')).toContain('sources: 1 runnable');

    const state = stateResponseSchema.parse(await (await fetch(`${base(running.port)}/api/state`)).json());
    expect(state.masthead.name).toBe('The Temp Ledger');
    expect(state.sources).toHaveLength(1);
    // Never polled, and said: the state is `unknown`, not `ok` and not a silent zero.
    expect(state.sources[0]).toMatchObject({ id: 'bbc', state: 'unknown', itemCount: 0, cadenceMinutes: 20 });
    await running.close();
  });

  it('prints every issue a source file raised, and boots with the files that parsed', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec());
    await writeJson(join(root, 'sources', 'broken.json'), { id: 'broken', kind: 'rss' });
    const { logs, running } = await bootOnce(root);
    const text = logs.join('\n');
    expect(text).toContain('refused:');
    expect(text).toContain('broken.json');
    const state = stateResponseSchema.parse(await (await fetch(`${base(running.port)}/api/state`)).json());
    expect(state.sources.map((source) => source.id)).toEqual(['bbc']);
    await running.close();
  });

  it('refuses a second process on the database claim, by name, before serving', async () => {
    const root = await tempRoot();
    const first = await bootOnce(root);
    const secondLogs: string[] = [];
    let cause: unknown = null;
    try {
      await boot({
        root,
        log: (line) => {
          secondLogs.push(line);
        },
        port: 0,
        host: '127.0.0.1',
        schedule: false,
        now: () => T0,
      });
    } catch (error) {
      cause = error;
    }
    expect(cause).toBeInstanceOf(DatabaseLockedError);
    const text = secondLogs.join('\n');
    expect(text).toContain('not starting:');
    expect(text).toContain('another process holds this database');
    await first.running.close();
  });

  it('serves the reading list as files, and writes one on a loopback POST (WP14)', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec());
    const { running } = await bootOnce(root);

    const listed = (await (await fetch(`${base(running.port)}/api/sources`)).json()) as {
      dir: string;
      writable: boolean;
      files: { file: string; id: string | null; text: string }[];
    };
    expect(listed.dir).toBe(join(root, 'sources'));
    expect(listed.writable).toBe(true);
    expect(listed.files.map((file) => [file.file, file.id])).toEqual([['bbc.json', 'bbc']]);
    expect(JSON.parse(listed.files[0]?.text ?? '{}').kind).toBe('rss');

    const written = await fetch(`${base(running.port)}/api/sources`, {
      method: 'POST',
      body: JSON.stringify({ text: JSON.stringify(anRssSpec({ id: 'reuters', label: 'Reuters' })) }),
    });
    expect(written.status).toBe(200);
    expect(JSON.parse(await readFile(join(root, 'sources', 'reuters.json'), 'utf8')).id).toBe('reuters');

    // The write refreshed the row, so the paper shows the source before any poll —
    // and `next_run_at` is null, so the next batch polls it first.
    const state = stateResponseSchema.parse(await (await fetch(`${base(running.port)}/api/state`)).json());
    expect(state.sources.map((source) => source.id)).toEqual(['bbc', 'reuters']);
    await running.close();
  });

  it('says what a loopback bind means, and where to change it', async () => {
    const root = await tempRoot();
    const { logs, running } = await bootOnce(root);
    expect(logs.join('\n')).toContain('this machine only');
    expect(logs.join('\n')).toContain('server.host');
    await running.close();
  });

  it('takes every seam at once — fetch, token, host, port, poll, onListen — and reports the claim', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec());
    const seen: number[] = [];
    const { logs, running } = await bootOnce(root, {
      fetch: async () => new Response(''),
      token: 'tok-fixed',
      onListen: (port) => {
        seen.push(port);
      },
      poll: async (spec) => aResult(spec.id),
      schedule: true,
    });
    expect(seen).toEqual([running.port]);
    expect(logs.join('\n')).toContain('claim tok-fixe');
    await running.close();
  });

  it('fills the paper from a real poll of a fixture feed, through the config file and the real pollOne', async () => {
    const root = await tempRoot();
    // Only the masthead and the host come from the config file; the port is a dep,
    // because a test binds 0 (an ephemeral port) and `server.port` is schema-bounded
    // to 1..65535 by design - a config that asks for 0 is a schema failure, reported,
    // and the defaults take over.
    await writeJson(join(root, 'config.json'), {
      masthead: { name: 'The Fixture Ledger' },
      server: { host: '127.0.0.1' },
    });
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec({ url: 'https://feeds.example/world.xml' }));
    const body = fixture('feed-bbc-world.xml');
    const logs: string[] = [];
    const running = await boot({
      root,
      log: (line) => {
        logs.push(line);
      },
      port: 0,
      schedule: true,
      fetch: async () => okResponse(body),
    });
    try {
      for (
        let i = 0;
        i < 80 && (running.db.items.countBySource().find((row) => row.sourceId === 'bbc')?.count ?? 0) === 0;
        i += 1
      ) {
        await new Promise((resolveSettle) => setTimeout(resolveSettle, 10));
      }
      const state = stateResponseSchema.parse(await (await fetch(`${base(running.port)}/api/state`)).json());
      const items = state.edition.sections.flatMap((section) => section.items);
      expect(items.length).toBeGreaterThan(0);
      expect(state.sources[0]).toMatchObject({ id: 'bbc', state: 'ok' });
      expect(logs.join('\n')).toContain('bbc: cadence →');
      expect(running.tally().newItems).toBe(items.length);
    } finally {
      await running.close();
    }
  });

  it('is a named failure, not a half-boot, when the database cannot be opened for another reason', async () => {
    const root = await tempRoot();
    // A file where a directory belongs: `mkdir` fails with ENOTDIR, which is not the
    // lock, and the run must stop with that reason and no server left listening.
    const filePath = join(root, 'not-a-directory');
    await writeFile(filePath, 'x\n', 'utf8');
    const logs: string[] = [];
    await expect(
      boot({
        root: join(filePath, 'deeper'),
        log: (line) => {
          logs.push(line);
        },
        schedule: false,
      }),
    ).rejects.toThrow(/ENOTDIR|not a directory|EPERM|EPERM/);
    expect(logs.join('\n')).not.toContain('not starting:');
  });

  it('starts the scheduler, which polls the watchlist and plans what it polled', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec({ cadenceMinutes: 20 }));
    const polled: SourceSpec[] = [];
    const { logs, running } = await bootOnce(root, {
      schedule: true,
      poll: async (spec) => {
        polled.push(spec);
        return aResult(spec.id);
      },
    });
    for (let i = 0; i < 60 && polled.length === 0; i += 1) {
      await new Promise((resolveSettle) => setTimeout(resolveSettle, 10));
    }
    expect(polled.map((spec) => spec.id)).toEqual(['bbc']);
    expect(logs.join('\n')).toContain('bbc: cadence →');
    expect(running.scheduler.claim.ok).toBe(true);
    expect(running.tally().planned).toBe(1);
    // The plan is in the row: a boot that polled and left a source unplanned is a
    // source the next batch would hammer. 20 minutes from the fixed T0, so the
    // boundary is exact: not due at +5, due at +21.
    expect(running.db.sources.dueSources('2026-11-09T10:05:00.000Z', 10)).toEqual([]);
    expect(running.db.sources.dueSources('2026-11-09T10:21:00.000Z', 10).map((source) => source.spec.id)).toEqual([
      'bbc',
    ]);
    await running.close();
  });

  it('reuses the row a previous boot wrote, and does not reset the plan on restart', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec({ cadenceMinutes: 60 }));
    const first = await bootOnce(root, {
      poll: async (spec) => aResult(spec.id),
      schedule: true,
    });
    await new Promise((resolveSettle) => setTimeout(resolveSettle, 40));
    const plannedAt = first.running.db.sources
      .dueSources('2026-11-09T10:30:00.000Z', 10)
      .map((source) => source.spec.id);
    await first.running.close();

    const second = await bootOnce(root, { schedule: false });
    // The restart re-upserted the same source (D-011: the file is the truth) and left
    // the countdown alone: `upsert` does not name the schedule columns (migration 5).
    expect(plannedAt).toEqual([]);
    expect(second.running.db.sources.dueSources('2026-11-09T10:30:00.000Z', 10)).toEqual([]);
    expect(
      second.running.db.sources.dueSources('2026-11-09T11:01:00.000Z', 10).map((source) => source.spec.id),
    ).toEqual(['bbc']);
    expect(second.running.db.sources.get('bbc')?.spec.cadenceMinutes).toBe(60);
    await second.running.close();
  });
});
