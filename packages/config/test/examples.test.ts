/**
 * The shipped examples are an onboarding path, so they are **validated, not
 * assumed**. A fresh clone has no `config.json` and no `sources/` (rule 18: both are
 * gitignored), so the example tree is the only place a reader learns the shape — and
 * an example that fails its own schema ships a broken first run, which is the kind of
 * failure that reads as "this tool is broken" rather than "this file is wrong" (rule 5).
 *
 * The privacy default is asserted here too: the config example binds **loopback**.
 * Binding the paper to the LAN is the reader's decision (D-034), so the file a reader
 * copies must not make it for them.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appConfigSchema, defaultAppConfig, sourceSchema } from '../src/schema.ts';
import { schemaUrlFor } from '../src/schemaUrls.ts';

/** The repo root, from this file's location — the examples are shipped there. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const example = async (name: string): Promise<string> => readFile(join(ROOT, name), 'utf8');
const sourcesExampleDir = join(ROOT, 'sources.example');

describe('config.example.json', () => {
  it('parses as an app config, so the file a reader copies is a file the loader accepts', async () => {
    const parsed = appConfigSchema.safeParse(JSON.parse(await example('./config.example.json')) as unknown);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Every value the example names is a real knob, and each default it prints is the
    // loader's own default — an example that lies about a default is worse than one
    // that omits the key.
    const config = parsed.data;
    expect(config.masthead.name).toBe(defaultAppConfig().masthead.name);
    expect(config.masthead.tagline).toBe(defaultAppConfig().masthead.tagline);
    expect(config.server.port).toBe(8787);
    expect(config.scheduler.maxFailuresBeforePause).toBe(6);
    expect(config.notify.quietHours).toEqual({ startHour: 23, endHour: 7 });
  });

  it("binds loopback, because the LAN is the reader's line to write (D-034)", async () => {
    const parsed = appConfigSchema.parse(JSON.parse(await example('./config.example.json')) as unknown);
    expect(parsed.server.host).toBe('127.0.0.1');
  });

  it('points $schema at the published appconfig schema (the URL, not a guess at it)', async () => {
    const raw = JSON.parse(await example('./config.example.json')) as { $schema?: string };
    expect(raw.$schema).toBe(schemaUrlFor('appconfig'));
  });
});

describe('sources.example/', () => {
  it('is every file a source the schema accepts, with the id the filename claims', async () => {
    const names = (await readdir(sourcesExampleDir)).filter((name) => name.endsWith('.json')).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const raw = JSON.parse(await readFile(join(sourcesExampleDir, name), 'utf8')) as unknown;
      const parsed = sourceSchema.safeParse(raw);
      expect(parsed.success, name).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.id, `${name} must be named for its id (D-011)`).toBe(name.replace(/\.json$/, ''));
    }
  });

  it("is example feeds, not a reader's list: no file carries a credential field", async () => {
    for (const name of await readdir(sourcesExampleDir)) {
      const text = await readFile(join(sourcesExampleDir, name), 'utf8');
      expect(text, name).not.toMatch(/"(cookie|cookies|authorization|token)"/i);
    }
  });
});
