/**
 * The database claim across two boots — the papercut this file owns.
 *
 * `start.test.ts` covers the clean double start: the first server is alive, it
 * holds the claim, the second is refused. This file owns the other arm, the one
 * that made `packages/server/src/lockOwner.ts`: the first server is **gone**. A
 * `pnpm start` killed with its process tree never runs the `close()` that gives
 * the claim back, so the row survives, naming a process that does not exist, and
 * the next boot answered "another process holds this database" about a process
 * that was not there — and then waited out `lockStaleAfterMs`, fifteen minutes of
 * a dead owner, before it would open its own paper.
 *
 * So the claim row is left here the way a force-kill leaves one: `openDatabase`
 * the file with a normal launch token, `update db_lock set owner = <dead owner>`,
 * `close()`. That close **deletes nothing** — `releaseLock` is
 * `delete from db_lock where id = 1 and owner = ?`, and the token it holds is not
 * the owner text just written — which is exactly the residue of a kill, and is
 * asserted, never assumed.
 *
 * Every boot runs at the injected `T0` (`startSupport.ts`), which is **earlier**
 * than the row's `taken_at`: under the age rule the claim is not even old yet, so
 * a boot that gets in has gotten in on the liveness proof and on nothing else.
 *
 * The third case is the arm the takeover must not leak into: an open that fails
 * for a reason other than the claim is a named failure, and prints no takeover
 * line at all.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { stateResponseSchema } from 'newspa-core';
import { DatabaseLockedError, openDatabase } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { ownerToken } from '../src/lockOwner.ts';
import { base, bootOnce, bootRefusal, T0, tempRoot } from './startSupport.ts';
import { deadOwner } from './support.ts';

/** The file `boot` opens, for a root: `data/newspa.db`. */
const dbFile = (root: string): string => join(root, 'data', 'newspa.db');

/**
 * Leave a claim row naming `owner`, as a force-killed server leaves one: a
 * launch opens the file (the migrations and `data/` are already there from the
 * boot before), hands the row to a text that will never heartbeat, and closes.
 * The close gives back nothing, because its token is not the owner.
 */
const leaveClaim = (root: string, owner: string): void => {
  const db = openDatabase(dbFile(root), { token: 'a-launch-that-is-gone', now: () => T0 });
  db.tx.run('update db_lock set owner = ?, taken_at = ? where id = 1', owner, T0.toISOString());
  db.close();
};

describe('the claim a force-killed server leaves behind', () => {
  it('is reclaimed at once, said by name, and the boot goes on to serve the paper', async () => {
    const root = await tempRoot();
    const first = await bootOnce(root);
    const dead = deadOwner();
    // A clean close gives **its own** claim back, so the row the takeover reads
    // is the one left below, and nothing is inherited from a graceful exit.
    await first.running.close();
    leaveClaim(root, dead);

    // The row is really there, and the age rule alone cannot get past it: an
    // opener with no liveness answer is refused. This is the state a force-kill
    // leaves, stated as a fact about the file rather than assumed by the test.
    expect(() => openDatabase(dbFile(root), { token: 'no-seam', now: () => T0 })).toThrow(DatabaseLockedError);

    const second = await bootOnce(root);
    try {
      const text = second.logs.join('\n');
      // Spoken, and spoken **with the owner's text**: "took the claim" is only a
      // report if the reader can see which claim, because the line has to
      // distinguish "my old server was force-killed" from "a second server is
      // running", and only the owner text can tell those apart.
      expect(text).toContain(`took the claim from "${dead}"`);
      expect(text).toContain('is not running');
      // The handle carries it too, so the takeover survives the log: `status`
      // and any later report can name the claim it came from.
      expect(second.running.db.tookOver?.owner).toBe(dead);

      // And the boot **succeeded**: the takeover is a sentence in a run that
      // works, not a warning printed over a dead one.
      const state = stateResponseSchema.parse(await (await fetch(`${base(second.running.port)}/api/state`)).json());
      expect(state.masthead.name).toBe('The Daily');
    } finally {
      await second.running.close();
    }
  });

  it('is not reclaimed when the owner is a running process, and the refusal names who it waits for', async () => {
    const root = await tempRoot();
    const first = await bootOnce(root);
    await first.running.close();
    // This test process is the owner: the probe asks the OS, so the claim is
    // **provably** alive. Reclaiming it is the failure the row exists to
    // prevent — two processes polling, and writing, one paper.
    const live = ownerToken();
    leaveClaim(root, live);

    const second = await bootRefusal(root);
    try {
      expect(second.cause).toBeInstanceOf(DatabaseLockedError);
      const text = second.logs.join('\n');
      expect(text).toContain('not starting:');
      // The owner is named, with the instant its claim was taken: "another
      // process holds this database" is only actionable if the reader can see
      // which process, and how long the wait is.
      expect(text).toContain(live);
      expect(text).toContain(T0.toISOString());

      // The refusal reclaimed nothing: reading the row back (the only way that
      // goes through the claim API is a takeover with a seam that lies) names
      // the **live** owner, so its heartbeat is still its own and the paper has
      // one writer.
      const reading = openDatabase(dbFile(root), {
        token: 'a-reader',
        now: () => T0,
        lockStaleAfterMs: 0,
        ownerIsAlive: () => false,
      });
      expect(reading.tookOver?.owner).toBe(live);
      reading.close();
    } finally {
      if (second.running !== null) await second.running.close();
    }
  });

  it('is not a takeover when the open itself fails: a broken file is a report, never a reclaimed claim', async () => {
    const root = await tempRoot();
    const first = await bootOnce(root);
    const file = dbFile(root);
    await first.running.close();
    // A directory where the database file is. The open fails for a reason that is
    // not the claim, and the takeover line has to stay silent: a reader told "the
    // claim was reclaimed, that process is not running" about an unopenable file
    // believes the paper is fine and the poll is running.
    await rm(file, { recursive: true });
    await mkdir(file, { recursive: true });

    const second = await bootRefusal(root);
    try {
      expect(second.cause).toBeInstanceOf(Error);
      expect(second.cause).not.toBeInstanceOf(DatabaseLockedError);
      // Rule 5: the reason is named, not swallowed on the way to "no paper".
      expect(String(second.cause)).toMatch(/CANTOPEN|unable to open|EISDIR|EPERM|EBUSY|SQLITE/i);
      const text = second.logs.join('\n');
      expect(text).not.toContain('took the claim from');
      expect(text).not.toContain('not starting:');
      // And no half-boot: nothing was served.
      expect(second.running).toBeNull();
    } finally {
      if (second.running !== null) await second.running.close();
    }
  });
});
