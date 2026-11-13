/**
 * The TLS boot (WP17): the socket answers HTTPS, and a pair that cannot be read
 * stops the process.
 *
 * The acceptance the roadmap asks for, run at the socket rather than by reading
 * `start.ts`: a boot with a minted pair serves `/api/state` over `https://` to a
 * client that trusts the certificate, the plaintext request to that port is
 * refused, the reach line prints the scheme it speaks, and a config naming a file
 * that is not there **does not start** — with no database claim taken, no
 * migration run, and the file named in the log.
 *
 * The pair is minted per run (`tlsFixture.ts`, D-040): the repository holds no PEM,
 * so `pnpm check:secrets` is green by construction.
 */

import { access } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TlsConfigError } from '../src/tls.ts';
import { bootOnce, bootRefusal, tempRoot, writeJson } from './startSupport.ts';
import { mintTlsPair } from './tlsFixture.ts';

/** A request over TLS, with the minted certificate as the only trusted CA. */
const getOverTls = (port: number, ca: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = https.request(`https://127.0.0.1:${String(port)}/api/state`, { ca }, (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });

/** A plaintext request to the TLS port: the answer is an error, and the test names it. */
const getOverPlainHttp = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const req = http.request(`http://127.0.0.1:${String(port)}/api/state`, {}, (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve(`answered ${String(res.statusCode)}: ${body.slice(0, 60)}`));
    });
    req.on('error', (cause) =>
      resolve(`refused: ${(cause as NodeJS.ErrnoException).code ?? cause.message}`.slice(0, 80)),
    );
    req.end();
  });

const rootWithTls = async (): Promise<{ root: string; certPem: string; keyPem: string }> => {
  const root = await tempRoot();
  const pair = await mintTlsPair();
  await pair.writeTo(join(root, 'tls'));
  // Relative paths, the form the docs teach: a clone of the repo finds the files
  // under its own root, and no machine's absolute path enters a config file.
  await writeJson(join(root, 'config.json'), {
    server: { host: '127.0.0.1', openBrowser: false, tls: { cert: 'tls/test-cert.pem', key: 'tls/test-key.pem' } },
  });
  return { root, certPem: pair.certPem, keyPem: pair.keyPem };
};

describe('a boot with server.tls', () => {
  it('serves /api/state over HTTPS to a client that trusts the certificate', async () => {
    const { root, certPem } = await rootWithTls();
    const { logs, running } = await bootOnce(root);
    try {
      const answer = await getOverTls(running.port, certPem);
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toHaveProperty('sources');
    } finally {
      await running.close();
    }
    // The scheme is printed from the same decision that built the socket, so a
    // reader copies a URL that works (D-034: the address is the wall).
    const reach = logs.filter((line) => line.includes('listening on '));
    expect(reach.join('\n')).toContain(`https://127.0.0.1:${String(running.port)}`);
    expect(reach.join('\n')).not.toContain(`http://127.0.0.1:${String(running.port)}`);
    // And the certificate's half of the promise, said at boot (D-039's kiosk case:
    // a panel that trusts no private CA connects to nothing).
    expect(logs.join('\n')).toContain('mkcert -install');
  });

  it('logs which files it read, and says the key is not in the config', async () => {
    const { root } = await rootWithTls();
    const { logs, running } = await bootOnce(root);
    await running.close();
    const tlsLine = logs.find((line) => line.startsWith('tls: ')) ?? '';
    expect(tlsLine).toContain('tls/test-cert.pem');
    expect(tlsLine).toContain('tls/test-key.pem');
    expect(tlsLine).toContain('export --bundle');
  });

  it('refuses a plaintext request to the TLS port, loudly, in the handshake', async () => {
    const { root } = await rootWithTls();
    const { running } = await bootOnce(root);
    try {
      const outcome = await getOverPlainHttp(running.port);
      // An HTTP client speaking to a TLS socket is answered by OpenSSL, not by the
      // router: the request never reaches a route, so no API body is leaked and the
      // reader sees a protocol error naming itself.
      expect(outcome).toContain('refused');
    } finally {
      await running.close();
    }
  });

  it('stops the boot when a path has a typo, names the file, and takes no claim', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'config.json'), {
      server: { host: '127.0.0.1', openBrowser: false, tls: { cert: 'tls/typo.pem', key: 'tls/typo-key.pem' } },
    });
    const { logs, cause, running } = await bootRefusal(root);
    expect(running).toBeNull();
    expect(cause).toBeInstanceOf(TlsConfigError);
    expect(logs.join('\n')).toContain('typo.pem');
    expect(logs.join('\n')).toContain('not starting');
    // No fallback to plain HTTP, and no half-done boot: the TLS read comes before
    // the database open, so nothing was claimed and no `data/` was written.
    expect(logs.join('\n')).not.toContain('listening on');
    await expect(access(join(root, 'data'))).rejects.toThrow();
  });

  it('boots plain HTTP when the config has no tls block, unchanged', async () => {
    const root = await tempRoot();
    await writeJson(join(root, 'config.json'), { server: { host: '127.0.0.1', openBrowser: false } });
    const { logs, running } = await bootOnce(root);
    try {
      const answer = await new Promise<number>((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${String(running.port)}/api/state`, (res) =>
          resolve(res.statusCode ?? 0),
        );
        req.on('error', reject);
        req.end();
      });
      expect(answer).toBe(200);
    } finally {
      await running.close();
    }
    expect(logs.some((line) => line.startsWith('tls: '))).toBe(false);
    expect(logs.join('\n')).toContain(`http://127.0.0.1:${String(running.port)}`);
  });
});
