/**
 * The address policy (D-034): who may reach what, and what the boot says about it.
 *
 * The server has no authentication, so these functions **are** the access control,
 * and they draw four lines, not one: the paper is readable by anyone the bind
 * reaches; every write is loopback-only **except** the one narrowed room (D-034, W4) —
 * `/api/sources` answers a household peer in the **household scope**, where the file
 * text, watchwords and notes (rule 18) never travel; and `/api/pick` is loopback-only
 * for every verb, because it opens a browser on the desk. The boot line carries those
 * facts, because a bind that quietly opens a private file set is the silent zero with
 * a listener on it.
 */
import { describe, expect, it } from 'vitest';
import {
  firewallHint,
  isLoopback,
  mutationAllowed,
  reachLine,
  readingListAllowed,
  sourcesAllowed,
  urlsOf,
} from '../src/net.ts';

describe('isLoopback', () => {
  it('accepts the forms a socket actually presents', () => {
    for (const address of ['127.0.0.1', '127.0.0.53', '::1', '::ffff:127.0.0.1', 'localhost']) {
      expect(isLoopback(address), address).toBe(true);
    }
  });

  it('refuses the addresses a phone in the house has', () => {
    for (const address of ['192.168.1.42', '10.0.0.7', '172.16.3.9', '2001:db8::5', 'fe80::1']) {
      expect(isLoopback(address), address).toBe(false);
    }
  });

  it('refuses an unknown peer: no address is not permission', () => {
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('urlsOf', () => {
  it('returns the typeable URL for a specific bind', () => {
    expect(urlsOf('192.168.1.5', 8787)).toEqual(['http://192.168.1.5:8787']);
    expect(urlsOf('127.0.0.1', 8787)).toEqual(['http://127.0.0.1:8787']);
    expect(urlsOf('localhost', 8787)).toEqual(['http://localhost:8787']);
  });

  it('treats an empty bind as "everything", like `*` and `0.0.0.0`', () => {
    expect(urlsOf('', 8787).at(-1)).toBe('http://127.0.0.1:8787');
  });

  it('ends with the loopback URL when bound to everything, and never prints 0.0.0.0', () => {
    for (const host of ['0.0.0.0', '::', '*']) {
      const urls = urlsOf(host, 8787);
      expect(urls.at(-1), host).toBe('http://127.0.0.1:8787');
      expect(
        urls.some((url) => url.includes('0.0.0.0')),
        host,
      ).toBe(false);
      for (const url of urls) expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:8787$/);
    }
  });
});

describe('the boot line', () => {
  it('says a loopback bind is this machine only, and points at the config', () => {
    const line = reachLine('127.0.0.1', 8787);
    expect(line).toContain('http://127.0.0.1:8787');
    expect(line).toContain('this machine only');
    expect(line).toContain('server.host');
  });

  it('recognises `localhost` as a machine-only bind, not a LAN one', () => {
    expect(reachLine('localhost', 8787)).toContain('this machine only');
  });

  it('names the reading list, the household switches, and the firewall command for a LAN bind', () => {
    const line = reachLine('0.0.0.0', 8787);
    expect(line).toContain('source names');
    // The W4 ruling, stated at boot: the household can move the switches, and the
    // file — its text, watchwords, notes, headers — stays where the server runs.
    expect(line).toContain("move a source's switches");
    expect(line).toContain('watchwords');
    expect(line).toContain('stay on this machine');
    // The platform is the machine's own here, and the test reads it back from the
    // same function: the printed command is the one for the machine that printed it.
    expect(line).toContain(firewallHint(8787, process.platform));
  });
});

/**
 * The scheme and the firewall command (WP17). Both are the boot's promise about the
 * socket, and the second is the one a reader runs: `0.0.0.0` binds, the bind
 * succeeds, and a firewall that drops every inbound packet is indistinguishable
 * from a dead server. An invented command is worse than none, so the arms other
 * than this machine's are asserted as strings, not executed.
 */
describe('the scheme, and the firewall by platform', () => {
  it('prints https URLs when the server speaks TLS, and http when it does not', () => {
    expect(urlsOf('127.0.0.1', 8787, 'https')).toEqual(['https://127.0.0.1:8787']);
    expect(urlsOf('192.168.0.223', 8787, 'https')).toEqual(['https://192.168.0.223:8787']);
    // The unspecified bind keeps its "last entry is typeable loopback" shape, so the
    // only thing the scheme changes is the prefix.
    const urls = urlsOf('0.0.0.0', 8787, 'https');
    expect(urls.at(-1)).toBe('https://127.0.0.1:8787');
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true);
    expect(urlsOf('127.0.0.1', 8787)).toEqual(['http://127.0.0.1:8787']);
  });

  it('says, over HTTPS, that the certificate is only as trusted as the devices that know its CA', () => {
    const overTls = reachLine('127.0.0.1', 8787, 'https');
    expect(overTls).toContain('mkcert -install');
    // A plain-HTTP boot must not start talking about certificates: the kiosk note is
    // a fact about TLS, and unasked advice reads as a warning about the config.
    expect(reachLine('127.0.0.1', 8787)).not.toContain('mkcert');
  });

  it('gives Windows the exact rule, Linux the command it ships, macOS the pane, and nothing a fiction', () => {
    expect(firewallHint(8787, 'win32')).toBe(
      'netsh advfirewall firewall add rule name="newspa" dir=in action=allow protocol=TCP localport=8787',
    );
    const linux = firewallHint(8787, 'linux');
    expect(linux).toContain('sudo ufw allow 8787/tcp');
    expect(linux).toContain('firewall-cmd');
    expect(firewallHint(8787, 'darwin')).toContain('Firewall');
    expect(firewallHint(8787, 'darwin')).toContain('8787');
    // The stated silence: naming a command for a platform this file has not measured
    // is how a reader ends up running something that changes nothing.
    const other = firewallHint(8787, 'freebsd');
    expect(other).toContain('freebsd');
    expect(other).toContain('8787');
    expect(other).toContain('no known firewall command');
  });
});

describe('mutationAllowed', () => {
  it('lets GET and HEAD from anywhere', () => {
    for (const method of ['GET', 'HEAD']) {
      expect(mutationAllowed(method, '203.0.113.9').allowed).toBe(true);
    }
  });

  it('lets a write from loopback, and refuses one from the LAN with the reason in it', () => {
    expect(mutationAllowed('POST', '127.0.0.1').allowed).toBe(true);
    const refused = mutationAllowed('POST', '192.168.1.42');
    expect(refused.allowed).toBe(false);
    if (refused.allowed === false) {
      expect(refused.reason).toContain('192.168.1.42');
      expect(refused.reason).toContain('no authentication');
      expect(refused.reason).toContain('D-034');
    }
  });

  it('refuses DELETE from a peer with no address, in a sentence that says so', () => {
    const refused = mutationAllowed('DELETE', undefined);
    expect(refused.allowed).toBe(false);
    if (refused.allowed === false) expect(refused.reason).toContain('unknown peer');
  });

  it('lets one room be narrower: a LAN POST to /api/sources rides the household scope (W4)', () => {
    expect(mutationAllowed('POST', '192.168.1.42', '/api/sources').allowed).toBe(true);
    // Every other door stays shut, same peer, same verb: the exception is this route
    // and this verb, and the reason names the room, so a refused phone is told.
    expect(mutationAllowed('POST', '192.168.1.42', '/api/state').allowed).toBe(false);
    expect(mutationAllowed('POST', '192.168.1.42', '/api/pick').allowed).toBe(false);
    expect(mutationAllowed('DELETE', '192.168.1.42', '/api/sources').allowed).toBe(false);
    expect(mutationAllowed('PUT', '192.168.1.42', '/api/sources').allowed).toBe(false);
    const refused = mutationAllowed('POST', '192.168.1.42', '/api/state');
    if (refused.allowed === false) expect(refused.reason).toContain('/api/sources');
  });
});

describe('readingListAllowed', () => {
  it('lets the pick open from loopback, on all of its verbs', () => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      expect(readingListAllowed(method, '127.0.0.1', 'pick').allowed, method).toBe(true);
      expect(readingListAllowed(method, '::ffff:127.0.0.1', 'pick').allowed, method).toBe(true);
      expect(readingListAllowed(method, '::1', 'pick').allowed, method).toBe(true);
    }
  });

  it('refuses the pick from the LAN: it reads a file and opens a browser on the desk', () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const refused = readingListAllowed(method, '192.168.1.42', 'pick');
      expect(refused.allowed, method).toBe(false);
      if (refused.allowed === false) {
        expect(refused.reason).toContain(method);
        expect(refused.reason).toContain('192.168.1.42');
        expect(refused.reason).toContain('rule 18');
        expect(refused.reason).toContain('rule 20');
        // The reason says *why* this one is loopback's: a browser opens on the server.
        expect(refused.reason).toContain('on the machine that runs this server');
      }
    }
  });

  it('refuses an unknown peer, in a sentence that says so', () => {
    const refused = readingListAllowed('POST', undefined, 'pick');
    expect(refused.allowed).toBe(false);
    if (refused.allowed === false) expect(refused.reason).toContain('unknown peer');
  });

  it('names the route it refused, because a reason that points at another URL is a dead end', () => {
    const pick = readingListAllowed('POST', '192.168.1.42', 'pick');
    if (pick.allowed === false) {
      expect(pick.reason).toContain('/api/pick from 192.168.1.42 is refused');
      expect(pick.reason).not.toContain('/api/sources');
    }
  });
});

describe('sourcesAllowed', () => {
  it('answers the desk in full scope, on every verb', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
      expect(sourcesAllowed(method, '127.0.0.1'), method).toEqual({ allowed: true, scope: 'full' });
      expect(sourcesAllowed(method, '::1'), method).toEqual({ allowed: true, scope: 'full' });
    }
  });

  it('answers a household peer in household scope for the read and the patch', () => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      expect(sourcesAllowed(method, '192.168.1.42'), method).toEqual({ allowed: true, scope: 'household' });
    }
  });

  it('refuses a LAN DELETE, and the reason points at the switch that does the job', () => {
    const refused = sourcesAllowed('DELETE', '192.168.1.42');
    expect(refused.allowed).toBe(false);
    if (refused.allowed === false) {
      expect(refused.reason).toContain('/api/sources from 192.168.1.42');
      expect(refused.reason).toContain('rule 18');
      expect(refused.reason).toContain('D-034');
      expect(refused.reason).toContain('"enabled"');
    }
  });

  it('refuses an unknown peer every verb (no address is not loopback)', () => {
    expect(sourcesAllowed('DELETE', undefined).allowed).toBe(false);
  });
});
