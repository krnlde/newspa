/**
 * The owner text of the `db_lock` claim, and the liveness answer (the papercut:
 * a force-killed server left its claim, and the next boot waited out
 * `lockStaleAfterMs` of its own dead owner).
 *
 * The claims are the ones the takeover depends on. `process.kill(pid, 0)` is the
 * probe, and the dead pid is `support.ts`'s: **a process that ran and exited**.
 * A made-up large pid is not a proof, because on Windows pids go that high, and
 * a test that passes by picking an unused number proves nothing about `ESRCH`.
 */
import { hostname } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { ownerIsAlive, ownerToken, parseOwner } from '../src/lockOwner.ts';
import { deadOwner } from './support.ts';

describe('the owner text', () => {
  it('is a per-launch nonce, this host, and this pid — in that order, parseable', () => {
    const parsed = parseOwner(ownerToken());
    expect(parsed.host).toBe(hostname());
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.nonce.length).toBeGreaterThan(8);
  });

  it('reads back as no process information when the text is not of this shape', () => {
    // A claim row written by an older build (the token used to be a bare uuid):
    // the answer is the age rule, and parsing must not throw on it.
    expect(parseOwner('b8f4a2c1-0000-4000-8000-000000000000')).toEqual({
      nonce: 'b8f4a2c1-0000-4000-8000-000000000000',
      host: '',
      pid: null,
    });
    expect(parseOwner('')).toEqual({ nonce: '', host: '', pid: null });
  });
});

describe('the liveness answer', () => {
  it('says this process is running', () => {
    expect(ownerIsAlive(ownerToken())).toBe(true);
  });

  it('says a process that ran and exited is not', () => {
    const owner = deadOwner();
    // The shared helper's text is one **this host** claims. That is the
    // precondition, stated: a foreign host's text is the age rule, never the
    // probe, so asserting `false` without it would prove nothing.
    expect(parseOwner(owner).host).toBe(hostname());
    expect(parseOwner(owner).pid).not.toBeNull();
    expect(ownerIsAlive(owner)).toBe(false);
  });

  it('says nothing about a pid on another machine, which is the age rule', () => {
    // The measured shape of the honest answer: a pid means a process only on the
    // host that wrote it. A claim from a machine sharing `data/` over a mount is
    // judged by its age, exactly as before this seam existed.
    expect(ownerIsAlive(`x@some-other-box:${String(process.pid)}`)).toBe(true);
    expect(ownerIsAlive('x@some-other-box:999999')).toBe(true);
  });

  it('treats a process it may not signal, and an answer that is not an errno, as running', () => {
    // `EPERM` is "a process exists, and I am not allowed to touch it" — a live
    // owner, and reclaiming it is two processes polling one paper. An answer
    // with no `code` is the same answer: this function may reclaim a claim it
    // can **prove** abandoned. A real EPERM needs another user's process, which
    // is not something a test may create, so the probe is the seam that moves.
    const mine = `x@${hostname()}:${String(process.pid)}`;
    const kill = vi.spyOn(process, 'kill');
    try {
      kill.mockImplementationOnce(() => {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      });
      expect(ownerIsAlive(mine)).toBe(true);
      kill.mockImplementationOnce(() => {
        throw new Error('not an errno at all');
      });
      expect(ownerIsAlive(mine)).toBe(true);
      // The spy is a one-shot: the probe is the real one again, and this process
      // is running, which is what a claim naming it has to hear.
      expect(ownerIsAlive(mine)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  it('says nothing when the text carries no pid, and refuses to reclaim on a bad number', () => {
    // Every one of these is "I cannot prove it dead", and the price of being
    // wrong is two processes polling one paper.
    expect(ownerIsAlive('a-token-with-no-shape')).toBe(true);
    expect(ownerIsAlive(`x@${hostname()}:not-a-pid`)).toBe(true);
    expect(ownerIsAlive(`x@${hostname()}:0`)).toBe(true);
    expect(ownerIsAlive(`x@${hostname()}:-7`)).toBe(true);
  });
});
