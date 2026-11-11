/**
 * The address policy (D-034): who may reach what, and what the boot says about it.
 *
 * The server has no authentication, so these functions **are** the access control,
 * and they draw three lines, not one: the paper is readable by anyone the bind
 * reaches; every write is loopback-only; and the reading-list route (`/api/sources`)
 * is loopback-only for **every verb**, because its answer is the source files and the
 * files are what rule 18 keeps private. The boot line carries those facts, because a
 * bind that quietly opens a private file set is the silent zero with a listener on it.
 */
import { describe, expect, it } from 'vitest';
import { firewallHint, isLoopback, mutationAllowed, reachLine, readingListAllowed, urlsOf } from '../src/net.ts';

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

  it('names the reading list, the writes rule and the firewall command for a LAN bind', () => {
    const line = reachLine('0.0.0.0', 8787);
    expect(line).toContain('source names');
    expect(line).toContain('loopback-only');
    expect(line).toContain(firewallHint(8787));
    expect(firewallHint(8787)).toBe(
      'netsh advfirewall firewall add rule name="newspa" dir=in action=allow protocol=TCP localport=8787',
    );
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
});

describe('readingListAllowed', () => {
  it('lets every verb from loopback — the editor is a machine-local tool', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
      expect(readingListAllowed(method, '127.0.0.1').allowed, method).toBe(true);
      expect(readingListAllowed(method, '::ffff:127.0.0.1').allowed, method).toBe(true);
      expect(readingListAllowed(method, '::1').allowed, method).toBe(true);
    }
  });

  it('refuses even a GET from the LAN: the answer is the files, and the files are the reading list', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
      const refused = readingListAllowed(method, '192.168.1.42');
      expect(refused.allowed, method).toBe(false);
      if (refused.allowed === false) {
        expect(refused.reason).toContain(method);
        expect(refused.reason).toContain('192.168.1.42');
        expect(refused.reason).toContain('rule 18');
        expect(refused.reason).toContain('D-034');
        // The sentence points at the paper, which stays readable: a refusal that
        // reads as "the server is closed" would be a lie about the LAN requirement.
        expect(refused.reason).toContain('the paper itself is readable');
      }
    }
  });

  it('refuses an unknown peer, in a sentence that says so', () => {
    const refused = readingListAllowed('GET', undefined);
    expect(refused.allowed).toBe(false);
    if (refused.allowed === false) expect(refused.reason).toContain('unknown peer');
  });

  it('names the route it refused, because a reason that points at another URL is a dead end', () => {
    const sources = readingListAllowed('GET', '192.168.1.42');
    const pick = readingListAllowed('POST', '192.168.1.42', 'pick');
    if (sources.allowed === false) expect(sources.reason).toContain('/api/sources from');
    if (pick.allowed === false) {
      expect(pick.reason).toContain('/api/pick from 192.168.1.42 is refused');
      expect(pick.reason).not.toContain('/api/sources');
      // The reason says *why* this one is loopback's: a browser opens on the server.
      expect(pick.reason).toContain('on the machine that runs this server');
      expect(pick.reason).toContain('rule 20');
      expect(pick.reason).toContain('rule 18');
    }
  });

  it('lets the pick open from loopback, on both of its verbs', () => {
    for (const method of ['GET', 'POST']) {
      expect(readingListAllowed(method, '127.0.0.1', 'pick').allowed, method).toBe(true);
      expect(readingListAllowed(method, '::1', 'pick').allowed, method).toBe(true);
    }
  });
});
