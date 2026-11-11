/**
 * The address question (D-034): the paper is one page, and a page is only useful
 * if the reader can open it on the phone in the next room.
 *
 * The server has **no authentication** — rule 17 is that nothing in this repo
 * authenticates anything to anyone — so the bind address is the access control, and
 * these four functions are where that is decided, in one place, testably:
 *
 *  - loopback is the default, and LAN is a line in `config.json` (`server.host`);
 *  - a **non-GET** from a non-loopback peer is refused: `/api/state` shows the
 *    reading list to the household (rule 18 says that list is a statement about what
 *    a reader cares about), and a page on the LAN that could *write* a
 *    `sources/*.json` file is a hole with no lock on it;
 *  - binding beyond loopback is **said out loud** at boot, with the URL to type and
 *    the firewall command, because Windows blocks inbound `8787` and "it works on my
 *    machine" with a silent failure to connect is rule 5's silent zero wearing a
 *    browser's clothes.
 */
import { networkInterfaces } from 'node:os';

/** The IPv6-mapped prefix `node:http` hands a socket connected to `::` or `::1`. */
const MAPPED_V4 = '::ffff:';

const LOOPBACK_V6 = new Set(['::1', '::ffff:127.0.0.1', 'localhost']);

/** The addresses a peer must come from to be allowed to mutate anything. */
export const isLoopback = (address: string | undefined): boolean => {
  if (address === undefined) return false;
  // `node:http` hands a v4 peer as `::ffff:127.0.0.1`; slicing the prefix once makes
  // the v4 and v6 tests the same test, and a v6 loopback (`::1`) survives the slice.
  const bare = address.startsWith(MAPPED_V4) ? address.slice(MAPPED_V4.length) : address;
  if (LOOPBACK_V6.has(bare)) return true;
  // `127.0.0.0/8`, not just `127.0.0.1`: the whole block is loopback on every
  // platform this runs on, and `localhost` resolves into it.
  return bare.startsWith('127.');
};

/** The bind address, as it appears in a URL. `0.0.0.0` and `::` are not typeable. */
const isUnspecified = (host: string): boolean => host === '0.0.0.0' || host === '::' || host === '*' || host === '';

/** Loopback hosts a user can write in the config, so the boot line can recognise them. */
const isLoopbackHost = (host: string): boolean => host === 'localhost' || isLoopback(host);

/**
 * Every URL a reader can type for this server, from the machine's own interfaces.
 *
 * A specific bind address yields itself; an unspecified bind (`0.0.0.0`) yields the
 * real interfaces, which is the answer the requirement is after — a phone needs an
 * address that exists on the network, and `http://0.0.0.0:8787` is not one.
 */
export const urlsOf = (host: string, port: number): string[] => {
  if (!isUnspecified(host)) return [`http://${host}:${String(port)}`];
  const lan: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      // IPv4 only, deliberately: a link-local IPv6 (`fe80::1`) is not typeable in a
      // browser's address bar (it needs a scope id), and a printed URL that does not
      // work is worse than one that is merely old-fashioned.
      if (entry.family !== 'IPv4') continue;
      if (!isLoopback(entry.address)) lan.push(`http://${entry.address}:${String(port)}`);
    }
  }
  // The loopback URL is appended, not read from the interfaces: Windows reports the
  // loopback interface as `internal`, and a reader on this machine still needs a
  // typeable address — `http://0.0.0.0:8787` is not one.
  return [...lan, `http://127.0.0.1:${String(port)}`];
};

/**
 * The Windows rule that lets the LAN in. Printing the exact command is the point:
 * a bind that succeeds while the firewall drops every packet is indistinguishable
 * from a dead server, and the reader has no way to know which it is.
 */
export const firewallHint = (port: number): string =>
  `netsh advfirewall firewall add rule name="newspa" dir=in action=allow protocol=TCP localport=${String(port)}`;

/** The one-line report about who can reach this server, printed at boot. */
export const reachLine = (host: string, port: number): string => {
  const urls = urlsOf(host, port);
  if (isLoopbackHost(host)) {
    return `listening on ${urls.join(', ')} — this machine only (server.host for LAN)`;
  }
  const urlsText = urls.join(', ');
  return (
    `listening on ${urlsText} — anyone on this network can read the paper, ` +
    `and /api/state shows your source list to them; writes stay loopback-only. ` +
    `If nothing connects, allow the port: ${firewallHint(port)}`
  );
};

/**
 * The guard, as a decision with a reason in it, so the route can answer with the
 * reason and a log can name it (rule 5: a refusal has to be legible).
 */
export const mutationAllowed = (
  method: string,
  address: string | undefined,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: string } => {
  if (method === 'GET' || method === 'HEAD') return { allowed: true };
  if (isLoopback(address)) return { allowed: true };
  return {
    allowed: false,
    reason: `${method} from ${address ?? 'an unknown peer'} is refused: this server has no authentication, so writes are loopback-only (D-034)`,
  };
};
