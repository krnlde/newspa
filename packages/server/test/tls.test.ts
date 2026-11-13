/**
 * The TLS config (WP17, D-039, D-040): the scheme, and the pair `config.json` names
 * by path.
 *
 * The claims are the ones a reader meets at the terminal, and they are the ones a
 * silent implementation would get wrong:
 *
 *  - a pair that **cannot be read** stops the boot, naming the file and why. The
 *    tempting implementation warns and falls back to plain HTTP; on the LAN address
 *    that is a page whose service worker quietly cannot register (D-039), and the
 *    reader's next act is to re-run `mkcert` and trust a root they already trusted;
 *  - a **PEM pasted into the config** is refused as what it is, and the key's text
 *    is not echoed into the log. `config.json` is the file `pnpm export --bundle`
 *    copies (rule 18), so a key in it is a key in every backup (rule 17);
 *  - the certificate and the key are **parsed**, not just read: the pair that is
 *    two certificates, a public key where the private one belongs, or a root CA
 *    where the leaf belongs fails inside the handshake as `EPROTO`, with no path in
 *    the message. Naming the file at boot costs one parse and saves that;
 *  - the scheme comes from one function, so the reach lines, the log and the tests
 *    cannot drift from what the socket speaks.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemeOf, TlsConfigError, tlsFailureLine, tlsMaterialOf } from '../src/tls.ts';
import { mintTlsPair, tempTlsDir } from './tlsFixture.ts';

describe('the scheme', () => {
  it('is http with no tls block, and https with one', () => {
    expect(schemeOf(null)).toBe('http');
    expect(schemeOf({ cert: 'tls/newspa-cert.pem', key: 'tls/newspa-key.pem' })).toBe('https');
  });
});

describe('the pair config.json names', () => {
  it('reads a real pair, from paths relative to the root', async () => {
    const dir = await tempTlsDir();
    const pair = await mintTlsPair();
    const paths = await pair.writeTo(dir);
    // Relative paths, because that is the form the docs teach (`tls/x.pem` under the
    // project root) and the form that survives a clone.
    const root = await tempTlsDir();
    await writeFile(join(root, 'x-cert.pem'), pair.certPem);
    await writeFile(join(root, 'x-key.pem'), pair.keyPem);
    const material = await tlsMaterialOf(root, { cert: 'x-cert.pem', key: 'x-key.pem' });
    expect(material.cert).toBe(pair.certPem);
    expect(material.key).toBe(pair.keyPem);
    const absolute = await tlsMaterialOf(dir, { cert: paths.certPath, key: paths.keyPath });
    expect(absolute.cert).toBe(pair.certPem);
  });

  it('refuses a missing cert, naming the file and the command that mints one', async () => {
    const dir = await tempTlsDir();
    const pair = await mintTlsPair();
    const paths = await pair.writeTo(dir);
    const cause = await tlsMaterialOf(dir, { cert: 'gone.pem', key: paths.keyPath }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(TlsConfigError);
    const message = (cause as TlsConfigError).message;
    expect(message).toContain('gone.pem');
    expect(message).toContain('cert');
    expect(message).toContain('ENOENT');
    expect(message).toContain('mkcert');
  });

  it('refuses a file that is not a PEM at all', async () => {
    const dir = await tempTlsDir();
    const pair = await mintTlsPair();
    const paths = await pair.writeTo(dir);
    const bogus = join(dir, 'not-a-pem.pem');
    await writeFile(bogus, 'I am a text file with a .pem name\n');
    const cause = await tlsMaterialOf(dir, { cert: bogus, key: paths.keyPath }).catch((e: unknown) => e);
    expect((cause as TlsConfigError).message).toContain('no PEM block');
  });

  it('refuses the two swapped files, because a key is not a certificate', async () => {
    const dir = await tempTlsDir();
    const pair = await mintTlsPair();
    // Swapped **contents**: the file named `cert` holds the key and the file named
    // `key` holds the certificate. Both parse-shape checks fire, and each names the
    // file it is complaining about — an `EPROTO` from the handshake names nothing.
    const certSlot = join(dir, 'swapped-cert.pem');
    const keySlot = join(dir, 'swapped-key.pem');
    const goodCert = join(dir, 'good-cert.pem');
    const goodKey = join(dir, 'good-key.pem');
    await Promise.all([
      writeFile(certSlot, pair.keyPem),
      writeFile(keySlot, pair.certPem),
      writeFile(goodCert, pair.certPem),
      writeFile(goodKey, pair.keyPem),
    ]);
    const certIsKey = await tlsMaterialOf(dir, { cert: certSlot, key: goodKey }).catch((e: unknown) => e);
    expect((certIsKey as TlsConfigError).message).toContain('swapped-cert.pem');
    expect((certIsKey as TlsConfigError).message).toContain('parsable X.509 certificate');
    const keyIsCert = await tlsMaterialOf(dir, { cert: goodCert, key: keySlot }).catch((e: unknown) => e);
    expect((keyIsCert as TlsConfigError).message).toContain('swapped-key.pem');
    expect((keyIsCert as TlsConfigError).message).toContain('parsable private key');
  });

  it('refuses a PEM pasted into the config, and does not echo the key', async () => {
    const dir = await tempTlsDir();
    const pair = await mintTlsPair();
    // The cert slot holds the key's text: the shape D-039 refuses, and the one a
    // reader reaches for when "TLS isn't working" — paste the file into the config.
    const cause = await tlsMaterialOf(dir, { cert: pair.keyPem, key: pair.keyPem }).catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(TlsConfigError);
    const message = (cause as TlsConfigError).message;
    expect(message).toContain('file path, not the key');
    expect(message).toContain('export --bundle');
    // The rule this protects: a key echoed into a log line is a key in a log file.
    expect(message).not.toContain('PRIVATE KEY');
    expect(message.length).toBeLessThan(400);
  });
});

describe('the line the process edge prints', () => {
  it('says nothing started, and names the file', async () => {
    const dir = await tempTlsDir();
    const missing = join(dir, 'nope.pem');
    const cause = await tlsMaterialOf(dir, { cert: missing, key: missing }).catch((e: unknown) => e);
    const line = tlsFailureLine(cause);
    expect(line).toContain('not starting');
    expect(line).toContain('nope.pem');
    expect(line).toContain('plain HTTP');
  });

  it('keeps a cause that is not a TLS fault to its own message', () => {
    expect(tlsFailureLine(new Error('disk gone'))).toContain('server.tls: disk gone — not starting');
    expect(tlsFailureLine('a string')).toContain('a string');
  });
});
