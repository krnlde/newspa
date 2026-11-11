/**
 * The address policy (D-034): who may reach what, and what the boot says about it.
 *
 * The server has no authentication, so these functions are the access control, and
 * the LAN requirement's real cost is the pair of facts the boot line carries: the
 * paper shows the reading list, and writes stay loopback-only.
 */
import { describe, expect, it } from 'vitest';
import { firewallHint, isLoopback, mutationAllowed, reachLine, urlsOf } from '../src/net.ts';

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
    expect(line).toContain('source list');
    expect(line).toContain('writes stay loopback-only');
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
