/**
 * The address question (D-034): the paper is one page, and a page is only useful
 * if the reader can open it on the phone in the next room.
 *
 * The server has **no authentication** — rule 17 is that nothing in this repo
 * authenticates anything to anyone — so the bind address is the access control, and
 * these four functions are where that is decided, in one place, testably:
 *
 *  - loopback is the default, and LAN is a line in `config.json` (`server.host`);
 *  - a **non-GET** from a non-loopback peer is refused, with one narrowed room (W4):
 *    `/api/sources` answers a household peer in the **household scope** — the switches
 *    of a source are the household's to move, its `watchwords`, `notes`, `headers` and
 *    file text are the desk's (rule 18), and `pick` stays the desk's entirely;
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
    `and /api/state shows your source names to them; a household device can also move a source's switches ` +
    `(on/off, section, weight, cadence), while the source files themselves — the file text, watchwords, notes, headers — ` +
    `and deletions and picks stay on this machine. ` +
    `If nothing connects, allow the port: ${firewallHint(port)}.${tlsNote}`
  );
};

/**
 * The reading-list route's **pick** arm (WP14): loopback-only.
 *
 * D-034 opened the *paper* to the household — the page, the edition, the stream — and
 * the W4 ruling opened the source **switches** (see `sourcesAllowed`). A pick is neither:
 * it reads a source file (its url, headers, `profile: true` fact) and **launches a
 * browser on the machine that runs this server**. That is a remote control for the desk,
 * so it stays the desk's, and the refusal says so.
 *
 * This is not a token, cookie or "shared secret" bolted on to make a LAN write safe
 * (rule 20 forbids that): it is the same wall the bind already is, applied to one route.
 */
/** Which loopback-only surface a peer was refused from, so the reason names the route. */
export type ReadingListRoute = 'pick';

/** Why each route is loopback's, in the sentence the route answers with and the log prints. */
const READING_LIST_WHY: Record<ReadingListRoute, string> = {
  pick: 'a pick reads a source file (its url, headers, `profile: true` fact) and opens a browser **on the machine that runs this server**, so it is loopback-only (rule 18, rule 20); author sources from that machine, and the phone gets the paper',
};

export const readingListAllowed = (
  method: string,
  address: string | undefined,
  route: ReadingListRoute,
): PeerDecision => {
  if (isLoopback(address)) return { allowed: true };
  return {
    allowed: false,
    reason: `${method} /api/${route} from ${address ?? 'an unknown peer'} is refused: ${READING_LIST_WHY[route]}`,
  };
};

/** A guard's answer: allowed, or refused with the reason the route will print and the log will name. */
export type PeerDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * `/api/sources`, decided by the **peer's scope** (D-034, the W4 ruling).
 *
 *  - the machine that runs the server is `full`: it gets each file's verbatim text, and
 *    every verb. The text is the reading list — URLs, `watchwords`, `blockwords`,
 *    `notes`, `headers` — and rule 18 keeps that set local and unversioned, on the
 *    grounds that publishing it publishes its reader;
 *  - a device on the bound network is `household`: it gets the **switches** (`enabled`,
 *    `section`, `weight`, `cadenceMinutes`, label, url) and **no file text at all**, so
 *    the private fields are never on the wire, never in that browser's memory, and
 *    never posted back. `POST` carries a patch or a create, and the body schema is what
 *    refuses a key outside the switches;
 *  - `DELETE` stays the desk's, in either reading: removing a file removes the
 *    watchwords, notes and headers inside it, and turning a source off is the household
 *    act that achieves what a deletion is wanted for.
 *
 * No credential is involved, in any direction (rule 17, rule 20): the address is the
 * wall, and the wall now has a **narrower room** rather than a lock.
 */
export type SourcesDecision =
  | { readonly allowed: true; readonly scope: 'full' | 'household' }
  | { readonly allowed: false; readonly reason: string };

export const sourcesAllowed = (method: string, address: string | undefined): SourcesDecision => {
  const peer = address ?? 'an unknown peer';
  if (isLoopback(address)) return { allowed: true, scope: 'full' };
  if (method === 'GET' || method === 'HEAD') return { allowed: true, scope: 'household' };
  if (method === 'POST') return { allowed: true, scope: 'household' };
  return {
    allowed: false,
    reason:
      `${method} /api/sources from ${peer} is refused: a source file carries its watchwords, notes and headers, so the file itself stays on the machine that runs this server (rule 18, D-034); ` +
      'turning a source off is the household act — send {"enabled": false}',
  };
};

/**
 * The guard, as a decision with a reason in it, so the route can answer with the
 * reason and a log can name it (rule 5: a refusal has to be legible).
 *
 * One room is narrower than the wall (D-034, the W4 ruling): a **POST to
 * `/api/sources`** from the bound network is allowed past this guard, because its
 * scope decision is `sourcesAllowed` and its body is the household schema — a device
 * on the LAN moves a source's switches and never reads its file. Every other
 * non-GET from a non-loopback peer dies here, **before routing**, as rule 20 demands.
 */
export const mutationAllowed = (method: string, address: string | undefined, path = ''): PeerDecision => {
  if (method === 'GET' || method === 'HEAD') return { allowed: true };
  if (isLoopback(address)) return { allowed: true };
  if (path === '/api/sources' && method === 'POST') return { allowed: true };
  return {
    allowed: false,
    reason: `${method} from ${address ?? 'an unknown peer'} is refused: this server has no authentication, so writes are loopback-only (D-034), except a source's switches — send POST /api/sources {"id":"…","patch":{…}}`,
  };
};
