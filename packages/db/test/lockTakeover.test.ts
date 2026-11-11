/**
 * The claim of an owner that is **not running**.
 *
 * The age rule (`staleAfterMs`) is the only rule the db layer can write, and on
 * its own it is a fifteen-minute sentence to a reader whose server was
 * force-killed: the row says "taken at 14:02", the process that wrote it died at
 * 14:03, and the next boot answers "another process holds this database" about a
 * process that does not exist. So `claimLock` asks the caller — see
 * `packages/server/src/lockOwner.ts` for who answers and how — and these are the
 * cases that answer decides.
 */
import { describe, expect, it } from 'vitest';
import { claimLock, openDatabase, readLock, type Statements } from '../src/index.ts';
import { FIXED, later, sharedMemory } from './support.ts';

const at =
  (ms: number): (() => Date) =>
  (): Date =>
    later(FIXED, ms);

const claimOf = (tx: Statements): { owner: string; takenAt: string } | null => {
  const state = readLock(tx);
  return state.ok && state.owner !== null ? { owner: state.owner.owner, takenAt: state.owner.takenAt } : null;
};

describe('a claim whose owner is not running', () => {
  it('is taken at once, and the verdict names the owner it came from', () => {
    const shared = sharedMemory('lock-dead');
    const held = openDatabase(shared, { token: 'dead-owner', now: () => FIXED });
    const verdict = claimLock(held.tx, {
      token: 'newcomer',
      now: at(1_000),
      staleAfterMs: 60_000,
      isAlive: () => false,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error('unreachable: the claim was refused');
    expect(verdict.tookOver).toEqual({ owner: 'dead-owner', takenAt: FIXED.toISOString() });
    expect(claimOf(held.tx)).toEqual({ owner: 'newcomer', takenAt: at(1_000)().toISOString() });
  });

  it('is left alone when the caller says the owner is alive, at the same age', () => {
    const shared = sharedMemory('lock-alive');
    const held = openDatabase(shared, { token: 'live-owner', now: () => FIXED });
    const verdict = claimLock(held.tx, {
      token: 'newcomer',
      now: at(1_000),
      staleAfterMs: 60_000,
      isAlive: () => true,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable: a live owner kept the claim');
    expect(verdict.owner.owner).toBe('live-owner');
    expect(claimOf(held.tx)?.owner).toBe('live-owner');
  });

  it('is the same row when no caller answers at all: the age rule, unchanged', () => {
    const shared = sharedMemory('lock-no-seam');
    const held = openDatabase(shared, { token: 'owner', now: () => FIXED });
    const verdict = claimLock(held.tx, { token: 'newcomer', now: at(1_000), staleAfterMs: 60_000 });
    expect(verdict.ok).toBe(false);
  });

  it('is taken by exactly one newcomer: the second is refused by the owner it cannot prove dead', () => {
    const shared = sharedMemory('lock-race');
    const held = openDatabase(shared, { token: 'dead-owner', now: () => FIXED });
    // The answer that a real host gives: the dead one is dead, the newcomer is
    // a running process. A takeover written against the dead owner's own token
    // is what makes this a race with one winner.
    const isAlive = (owner: string): boolean => owner !== 'dead-owner';
    const first = claimLock(held.tx, { token: 'first', now: at(1_000), staleAfterMs: 60_000, isAlive });
    const second = claimLock(held.tx, { token: 'second', now: at(2_000), staleAfterMs: 60_000, isAlive });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable: two processes own one paper');
    expect(second.owner.owner).toBe('first');
    expect(claimOf(held.tx)?.owner).toBe('first');
  });

  it('reaches the open, so the boot can print what it did', () => {
    const shared = sharedMemory('lock-open-seam');
    const held = openDatabase(shared, { token: 'dead-owner', now: () => FIXED });
    const took = openDatabase(shared, {
      token: 'newcomer',
      now: at(1_000),
      lockStaleAfterMs: 60_000,
      ownerIsAlive: () => false,
    });
    expect(took.owner.owner).toBe('newcomer');
    expect(took.tookOver).toEqual({ owner: 'dead-owner', takenAt: FIXED.toISOString() });
    // The first open's heartbeat now fails: it is no longer the owner, and the
    // scheduler stops on that, which is the point of speaking the takeover.
    expect(held.extendClaim()).toBe(false);
    took.close();
  });

  it('is given back by a clean close, so the seam is only ever about a crash', () => {
    const shared = sharedMemory('lock-close');
    const held = openDatabase(shared, { token: 'owner', now: () => FIXED });
    held.close();
    const next = openDatabase(shared, { token: 'newcomer', now: at(1_000), lockStaleAfterMs: 60_000 });
    expect(next.tookOver).toBeNull();
    next.close();
  });
});
