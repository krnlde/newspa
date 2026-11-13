import { z } from 'zod';

/**
 * The app config: `config.json`, the machine's knobs.
 *
 * Split out of `schema.ts` at the 300-line cap (rule 1), and the cut is the one this
 * repo already uses everywhere: a **source** is a page in the reader's reading list,
 * one file per source under `sources/`; the **app config** is the machine — the
 * address, the scheduler, the scoring, the retention, the notifications, TLS. They
 * are validated by the same loader discipline, and a source file can never say
 * anything about the server, and the server can never say anything about a source.
 *
 * `.prefault({})`, not `.default({})`, on every section, and the difference is not
 * cosmetic: `default` passes the value straight through, so a missing section comes
 * back as `{}` typed as a fully-populated object — `config.masthead.name` is
 * `undefined` at runtime while the compiler swears it is a string. `prefault` feeds
 * the value through the schema, so nested defaults are applied. Measured on zod 4.6.7.
 */

export const appConfigSchema = z.object({
  masthead: z
    .object({
      name: z.string().min(1).max(40).default('The Daily'),
      tagline: z.string().min(1).max(120).default('As it happens, on your own machine'),
      dayStartHour: z.int().min(0).max(23).default(7),
      timezone: z.string().default('local'),
    })
    .prefault({}),
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.int().min(1).max(65_535).default(8787),
      openBrowser: z.boolean().default(true),
      /**
       * TLS as **paths, never PEM bytes** (D-039). A key inside `config.json` rides
       * into every `pnpm export --bundle` — the file that says who may read the
       * paper (rule 18: `server.host` is in it) would also be the file that ships
       * the key that proves the paper. `null` is plain HTTP, which is today's
       * behaviour and stays the default, and `config.example.json` ships no `tls`
       * block: a fresh clone that cannot boot is a worse first run than a file
       * without an optional key.
       *
       * A pair named here that cannot be read **stops the boot** (`server/tls.ts`):
       * a server that falls back to HTTP because a path has a typo is a page that
       * lost its scheme in silence, and on the LAN that is the difference between
       * an installable app and a phone that quietly cannot register a service
       * worker (rule 5).
       */
      tls: z
        .object({ cert: z.string().min(1), key: z.string().min(1) })
        .nullable()
        .prefault(null),
    })
    .prefault({}),
  scheduler: z
    .object({
      maxConcurrentFetches: z.int().min(1).max(16).default(4),
      maxConcurrentRenderers: z.int().min(1).max(4).default(1),
      jitterSpanMs: z.int().min(0).max(600_000).default(120_000),
      backoffBaseMs: z.int().min(1_000).max(600_000).default(60_000),
      backoffMaxMs: z.int().min(60_000).max(86_400_000).default(3_600_000),
      maxFailuresBeforePause: z.int().min(1).max(20).default(6),
      /** A source with no success this long ago is `stale`, not quiet. */
      staleAfterMinutes: z.int().min(60).max(10_080).default(2_880),
    })
    .prefault({}),
  scoring: z
    .object({
      watchwords: z.array(z.string().min(1).max(80)).default([]),
      blockwords: z.array(z.string().min(1).max(80)).default([]),
      recencyHalfLifeHours: z.number().min(1).max(336).default(24),
    })
    .prefault({}),
  burst: z
    .object({
      /** Above this fraction of new items, publish "source restructured" instead of a paper. */
      newRatioThreshold: z.number().min(0.05).max(1).default(0.4),
    })
    .prefault({}),
  retention: z
    .object({
      /** Raw response snapshots kept per source; older ones are deleted. */
      snapshotsPerSource: z.int().min(0).max(200).default(10),
      /** Edit diffs kept per item. Items themselves are kept forever. */
      editsPerItem: z.int().min(1).max(200).default(20),
      /** Days of item history the paper can page back through. */
      historyDays: z.int().min(1).max(2_000).default(120),
    })
    .prefault({}),
  notify: z
    .object({
      toasts: z.boolean().default(true),
      toastTitle: z.string().min(1).max(60).default('newspa'),
      minScoreForToast: z.number().min(0).default(6),
      maxToastsPerCycle: z.int().min(0).max(10).default(3),
      quietHours: z
        .object({
          startHour: z.int().min(0).max(23),
          endHour: z.int().min(0).max(23),
        })
        .optional(),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type MastheadConfig = AppConfig['masthead'];

export const defaultAppConfig = (): AppConfig => appConfigSchema.parse({});
