import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * The owner text of the `db_lock` claim, and the answer to "is that process running?".
 *
 * `packages/db` keeps the claim and knows nothing about processes (it is the
 * storage layer, and a PID means nothing to a row). The server owns the process,
 * so the server writes the text and answers the question, and `claimLock`'s
 * `isAlive` seam is where the two meet.
 *
 * The text is `<uuid>@<host>:<pid>`: a per-launch nonce, then the machine, then
 * the process. The nonce is the identity the heartbeat extends (a PID alone is
 * not per-launch: it is reused by the OS, and a restarted server would inherit
 * the dead one's claim and never learn that another is running). The host is
 * what makes the liveness answer honest: `pid` on **this** machine means a
 * process, and a `pid` on another machine means nothing, so a claim written
 * elsewhere is judged by the age rule alone — which is the whole rule set
 * before this file existed.
 *
 * The measured shape this buys: a `pnpm start` killed with its process tree
 * leaves the claim row (the `close()` that gives it back never runs), and the
 * next boot used to wait out `lockStaleAfterMs` — 15 minutes of its own dead
 * owner, printing a line about another process that was not there.
 */
export interface OwnerText {
  readonly nonce: string;
  readonly host: string;
  readonly pid: number | null;
}

/** The owner text for this launch. */
export const ownerToken = (): string => `${randomUUID()}@${hostname()}:${String(process.pid)}`;

/** The text, read back. Anything unparseable is "no process information". */
export const parseOwner = (owner: string): OwnerText => {
  const at = owner.indexOf('@');
  const colon = owner.lastIndexOf(':');
  if (at <= 0 || colon <= at) return { nonce: owner, host: '', pid: null };
  const pid = Number.parseInt(owner.slice(colon + 1), 10);
  return { nonce: owner.slice(0, at), host: owner.slice(at + 1, colon), pid: Number.isInteger(pid) ? pid : null };
};

/**
 * Is this claim's owner running?
 *
 * `signal 0` is the probe that asks without touching: `ESRCH` is "no such
 * process", `EPERM` is "a process exists that I may not signal". Every other
 * answer — a foreign host, a text with no pid, an out-of-range pid, an
 * unexpected error — is `true`, because the honest default is the age rule:
 * this function may reclaim a claim **it can prove** abandoned, and proving is
 * the whole job.
 */
export const ownerIsAlive = (owner: string): boolean => {
  const parsed = parseOwner(owner);
  if (parsed.pid === null || parsed.host !== hostname()) return true;
  if (parsed.pid <= 0) return true;
  try {
    process.kill(parsed.pid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return true;
  }
};
