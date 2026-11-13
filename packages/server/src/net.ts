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
 * address that exists on the network, and `0.0.0.0:8787` is not one.
 *
 * The scheme is an input, not a constant: `server.tls` decides it (WP17), and a
 * printed `http://` in front of a TLS socket is a URL that fails with an `EPROTO`
 * the reader cannot explain. One function owns both spellings, so the reach lines,
 * the boot log and the tests cannot drift from what the socket speaks.
 */
export const urlsOf = (host: string, port: number, scheme: 'http' | 'https' = 'http'): string[] => {
  const url = (address: string): string => `${scheme}://${address}:${String(port)}`;
  if (!isUnspecified(host)) return [url(host)];
  const lan: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      // IPv4 only, deliberately: a link-local IPv6 (`fe80::1`) is not typeable in a
      // browser's address bar (it needs a scope id), and a printed URL that does not
      // work is worse than one that is merely old-fashioned.
      if (entry.family !== 'IPv4') continue;
      if (!isLoopback(entry.address)) lan.push(url(entry.address));
    }
  }
  // The loopback URL is appended, not read from the interfaces: Windows reports the
  // loopback interface as `internal`, and a reader on this machine still needs a
  // typeable address — `0.0.0.0:8787` is not one.
  return [...lan, url('127.0.0.1')];
};

/**
 * The command that lets the LAN in, by platform, because a bind that succeeds while
 * the firewall drops every packet is indistinguishable from a dead server and the
 * reader has no way to know which it is.
 *
 * Windows is the machine this project grew on, so its rule is exact. Linux names
 * `ufw`, the common case on the board's host, with the `firewall-cmd` form
 * parenthetically because distros differ. Everything else — macOS, a BSD, a
 * container with no firewall — is **stated silence**: an invented command is worse
 * than none, because the reader runs it and it changes nothing.
 */
export const firewallHint = (port: number, platform: NodeJS.Platform = process.platform): string => {
  const portText = String(port);
  if (platform === 'win32') {
    return `netsh advfirewall firewall add rule name="newspa" dir=in action=allow protocol=TCP localport=${portText}`;
  }
  if (platform === 'linux') {
    return `sudo ufw allow ${portText}/tcp (or: sudo firewall-cmd --permanent --add-port=${portText}/tcp && sudo firewall-cmd --reload)`;
  }
  if (platform === 'darwin') {
    return `System Settings → Network → Firewall: allow incoming TCP on ${portText} (or: sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node)`;
  }
  return `no known firewall command for "${platform}": open incoming TCP on ${portText} wherever this machine keeps its rules`;
};

/** The one-line report about who can reach this server, printed at boot. */
export const reachLine = (host: string, port: number, scheme: 'http' | 'https' = 'http'): string => {
  const urls = urlsOf(host, port, scheme);
  // The certificate's half of the promise (D-039): a kiosk panel or a phone that
  // trusts no private CA will connect to nothing, and "it does not load" is what a
  // reader reports, not "the certificate is untrusted". So the line says what to do.
  const tlsNote =
    scheme === 'https'
      ? ' The certificate is only as trusted as the devices that know its CA: `mkcert -install` on each one, or one CA of your own.'
      : '';
  if (isLoopbackHost(host)) {
    return `listening on ${urls.join(', ')} — this machine only (server.host for LAN).${tlsNote}`;
  }
  const urlsText = urls.join(', ');
  return (
    `listening on ${urlsText} — anyone on this network can read the paper, ` +
    `and /api/state shows your source names to them; the source files themselves ` +
    `(watchwords, notes, sections) and every write stay loopback-only. ` +
    `If nothing connects, allow the port: ${firewallHint(port)}.${tlsNote}`
  );
};

/**
 * The reading-list route (WP14): **every verb is loopback-only.**
 *
 * D-034 opened the *paper* to the household — the page, the edition, the stream. This
 * route is not the paper. `GET /api/sources` answers each source file's **verbatim
 * text**: the URL set, the `watchwords`/`blockwords`, the `section` labels in the
 * reader's own words, the `notes`, the `profile: true` fact. Rule 18 keeps precisely
 * that set local and unversioned, on the grounds that publishing it publishes its
 * reader; serving those bytes to the LAN, in clear text, from a server that
 * authenticates nothing, is the leak the rule exists to prevent. So the editor is a
 * machine-local tool, read and write alike, and the phone gets the paper.
 *
 * This is not a token, cookie or "shared secret" bolted on to make a LAN write safe
 * (rule 20 forbids that): it is the same wall the bind already is, applied to one
 * route.
 */
/** Which loopback-only surface a peer was refused from, so the reason names the route. */
export type ReadingListRoute = 'sources' | 'pick';

/** Why each route is loopback's, in the sentence the route answers with and the log prints. */
const READING_LIST_WHY: Record<ReadingListRoute, string> = {
  sources:
    'the reading list is your file set — every URL, watchword and note — so it is loopback-only (rule 18, D-034); the paper itself is readable from anywhere this server is bound',
  pick: 'a pick reads a source file (its url, headers, `profile: true` fact) and opens a browser **on the machine that runs this server**, so it is loopback-only (rule 18, rule 20); author sources from that machine, and the phone gets the paper',
};

export const readingListAllowed = (
  method: string,
  address: string | undefined,
  route: ReadingListRoute = 'sources',
): PeerDecision => {
  if (isLoopback(address)) return { allowed: true };
  return {
    allowed: false,
    reason: `${method} /api/${route} from ${address ?? 'an unknown peer'} is refused: ${READING_LIST_WHY[route]}`,
  };
};

/**
 * A guard's answer: allowed, or refused with the reason the route will print and the
 * log will name (rule 5: a refusal has to be legible).
 */
export type PeerDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * The guard, as a decision with a reason in it, so the route can answer with the
 * reason and a log can name it (rule 5: a refusal has to be legible).
 */
export const mutationAllowed = (method: string, address: string | undefined): PeerDecision => {
  if (method === 'GET' || method === 'HEAD') return { allowed: true };
  if (isLoopback(address)) return { allowed: true };
  return {
    allowed: false,
    reason: `${method} from ${address ?? 'an unknown peer'} is refused: this server has no authentication, so writes are loopback-only (D-034)`,
  };
};
