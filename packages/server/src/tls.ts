import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * TLS material, read from the paths `config.json` names (WP17, D-039).
 *
 * **Paths, never PEM bytes.** `config.json` is the file that says who may read the
 * paper (`server.host`, D-034) and the file `pnpm export --bundle` copies into the
 * reading list's backup (rule 18). A key inside it would ride along with both, so
 * the schema takes two filenames and this module reads them at boot.
 *
 * **A pair that cannot be read stops the boot, and says which file and why.** The
 * tempting implementation — warn and fall back to plain HTTP — is the one failure
 * mode this package exists to avoid: on the LAN address, plain HTTP is not a
 * secure context, so a phone reading the paper would quietly be unable to install
 * it, and the reader's next act would be to re-run `mkcert` and trust a root they
 * already trusted. Rule 5, in the direction of a promise: the scheme the boot
 * printed is the scheme the socket speaks, and the reach lines name it (D-034).
 *
 * The certificate is parsed here, with `X509Certificate`, and the key with
 * `createPrivateKey`, because a file that is a certificate *shape* and a wrong
 * thing (a `fullchain` with no leaf first, a public key where the private one
 * belongs, a PFX pasted into a `.pem` name) fails inside the TLS handshake with an
 * `EPROTO` and no path in it. Naming the file at boot, before the first socket,
 * costs one parse.
 */

/** What `config.json` may say: two paths, relative to the project root. */
export interface TlsPaths {
  readonly cert: string;
  readonly key: string;
}

/** The bytes `createHttps` wants. */
export interface TlsMaterial {
  readonly cert: string;
  readonly key: string;
}

/** The scheme the boot prints, and the tests assert. One function, no string drift. */
export const schemeOf = (tls: TlsPaths | null): 'http' | 'https' => (tls === null ? 'http' : 'https');

export class TlsConfigError extends Error {
  readonly file: string;

  constructor(file: string, detail: string) {
    super(`server.tls: ${file}: ${detail}`);
    this.name = 'TlsConfigError';
    this.file = file;
  }
}

/** The line the process edge prints for a refused TLS config: the file, and the fact that nothing started. */
export const tlsFailureLine = (cause: unknown): string =>
  cause instanceof TlsConfigError
    ? `${cause.message} — not starting (no silent fallback to plain HTTP: on the LAN address that is a page that cannot install, D-039)`
    : `server.tls: ${cause instanceof Error ? cause.message || cause.name : String(cause)} — not starting`;

const absolute = (root: string, path: string, which: 'cert' | 'key'): string => {
  // The config takes **paths**. A reader who pastes the PEM into `config.json` —
  // the shape D-039 refuses — would otherwise be answered with a `resolve()` of a
  // thousand characters, and a key echoed into a log line is a key in a log file.
  if (path.includes('-----BEGIN')) {
    throw new TlsConfigError(
      path.slice(0, 24),
      `server.tls.${which} is a file path, not the key's text: put the PEM in a file and name the file (D-039: config.json is copied by export --bundle, and a key in it is a key in every backup)`,
    );
  }
  return isAbsolute(path) ? path : resolve(root, path);
};

const readCert = async (root: string, path: string): Promise<string> => {
  const file = absolute(root, path, 'cert');
  const text = await readText(file, 'cert');
  try {
    new X509Certificate(text);
  } catch (cause) {
    throw new TlsConfigError(
      file,
      `is not a parsable X.509 certificate (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}). The leaf comes first in a chain file; a root CA is not a certificate to serve`,
    );
  }
  return text;
};

const readKey = async (root: string, path: string): Promise<string> => {
  const file = absolute(root, path, 'key');
  const text = await readText(file, 'key');
  try {
    createPrivateKey(text);
  } catch (cause) {
    throw new TlsConfigError(
      file,
      `is not a parsable private key (${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}). A public key, a certificate, or a PFX renamed to .pem all land here`,
    );
  }
  return text;
};

const readText = async (file: string, which: 'cert' | 'key'): Promise<string> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    throw new TlsConfigError(
      file,
      `the ${which} file cannot be read (${code ?? 'error'}). mkcert -install && mkcert -key-file ${file} -cert-file <name> localhost 127.0.0.1 gives you both; the path is relative to the project root`,
    );
  }
  if (!text.includes('-----BEGIN')) {
    throw new TlsConfigError(
      file,
      `the ${which} file holds no PEM block ("-----BEGIN"): ${file} is not what its name says`,
    );
  }
  return text;
};

/**
 * Read the pair. The certificate first: a missing `cert` is the common typo, and
 * the answer names the file.
 */
export const tlsMaterialOf = async (root: string, tls: TlsPaths): Promise<TlsMaterial> => {
  const cert = await readCert(root, tls.cert);
  const key = await readKey(root, tls.key);
  return { cert, key };
};
