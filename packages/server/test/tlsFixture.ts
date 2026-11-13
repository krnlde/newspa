import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';

/**
 * A self-signed certificate, minted at test time (WP17, D-040).
 *
 * **Why a dependency, and which one.** WP17 needs an HTTPS server in a test. The
 * sources for that certificate, and what each costs:
 *
 * - a **committed PEM pair**, under the rule-17 fixtures exemption, discloses
 *   nothing — a self-signed cert for `127.0.0.1` has no identity, no data and no
 *   trust relationship behind it — but on a public repository it normalises the
 *   pattern rule 17 exists to stop, it is one `cp` away from `config.json` the day
 *   "TLS isn't working", and GitHub's scanner files an alert on it;
 * - **.NET / PowerShell** minting is Windows-only, so the test cannot run on the
 *   board's Linux host;
 * - **`mkcert`** needs a binary on PATH *and* a local root CA on the machine — a
 *   test that cannot pass on a fresh clone, the same objection the repo raises about
 *   a hook that needs Edge;
 * - **`@peculiar/x509`** (the first choice, measured out): it pulls `tsyringe`,
 *   which refuses to load without `import 'reflect-metadata'` at the entry point —
 *   a global side-effect, and a second dependency, for a test fixture. `selfsigned`
 *   is the same `@peculiar`/`pkijs` tree;
 * - **hand-assembling X.509 DER in `node:crypto`** was attempted, to zero
 *   dependencies, and produced a certificate that parsed, printed the right
 *   `subjectAltName`, and then failed `X509Certificate#verify()`. Four traps made
 *   that cert, each worth recording because each looks fine: extension numbers
 *   **are** the context tags (SAN `[3]`, SKID `[4]`, AKID `[5]`, inside
 *   `Extensions ::= [3] EXPLICIT SEQUENCE OF Extension`, each extension a
 *   **sibling** — nested one level deeper and Node reports no extensions); a
 *   self-signed leaf needs **both** key identifiers (RFC 5280 §§4.2.1.2/4.2.1.3 —
 *   without them Edge answers `unable to verify the first certificate`); the content
 *   of a context tag is DER and `IA5String`/`OCTET STRING` are **primitive**
 *   (`82 <len> <bytes>` for a DNS name, `87 <len> <4 raw bytes>` for an IP,
 *   `80 <len> <bytes>` for a key identifier — in the constructed `a2` form Node
 *   parses the *name bytes* as a TLV, which is asymmetric: 13-byte `127.0.0.1` reads
 *   as a plausible SEQUENCE so one host works and two answer
 *   `asn1 encoding routines::wrong tag`); and `Array.prototype.flat` **does not
 *   flatten a `Uint8Array`**, so `[u8, u8].flat()` is two elements, `new Uint8Array`
 *   of that is zeros, and a hand-built `TBSCertificate` becomes ten zero bytes.
 *
 * `node-forge` is pure JS with **zero dependencies** and no install-time script, so
 * `ignoreScripts`/`strictDepBuilds` in `pnpm-workspace.yaml` stay intact. It mints
 * into the OS temp dir: the repository holds no PEM, `pnpm check:secrets` is green
 * by construction rather than by exemption, and the same call can produce the arms
 * the tests need — a pair for a LAN IP, an expired pair, a cert whose key is a
 * different file.
 */
export interface MintedPair {
  readonly certPem: string;
  readonly keyPem: string;
  /** Write both into `dir`; `server.tls` takes paths, never bytes (D-039). */
  writeTo(dir: string): Promise<{ certPath: string; keyPath: string }>;
}

/** A `subjectAltName` entry: a DNS name, or an IP literal in the form forge wants. */
export type SubjectAlt =
  | { readonly type: 'dns'; readonly value: string }
  | { readonly type: 'ip'; readonly value: string };

const SAN_DEFAULT: readonly SubjectAlt[] = [
  { type: 'dns', value: 'localhost' },
  { type: 'ip', value: '127.0.0.1' },
];

/**
 * @param alt the `subjectAltName`. Node's TLS check matches the **address the client
 *   dialled**, so a test that dials `127.0.0.1` needs the IP entry and one that
 *   dials `localhost` needs the DNS name.
 * @param days the validity window; a negative `days` produces an expired pair, which
 *   is a case the boot has to answer for (a certificate is not a config value that
 *   can be trusted to be live).
 */
export const mintTlsPair = async (alt: readonly SubjectAlt[] = SAN_DEFAULT, days = 365): Promise<MintedPair> => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  const notBefore = new Date(Date.now() - 60 * 60 * 1000);
  const notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: 'commonName', value: 'newspa.test' }];
  cert.setSubject(attrs);
  // Issuer is the subject: this is a self-signed leaf, used as its own trust anchor
  // by a test client that passes it as `ca`. A real deployment uses `mkcert`, whose
  // CA is a separate certificate the devices trust (D-039's kiosk note).
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    {
      // forge spells this field `altNames` on a **certificate** (`alt` is the
      // certification-request form); a certificate extension built with `alt`
      // reaches the encoder with `altNames` undefined.
      name: 'subjectAltName',
      altNames: alt.map((entry) =>
        entry.type === 'dns' ? { type: 2, value: entry.value } : { type: 7, ip: entry.value },
      ),
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  return {
    certPem,
    keyPem,
    writeTo: async (dir: string) => {
      // The directory is created, not assumed: a test that names `root/tls` is
      // naming a path it has not made, and "the pair is where the config says it
      // is" is the whole job of this helper.
      await mkdir(dir, { recursive: true });
      const certPath = join(dir, 'test-cert.pem');
      const keyPath = join(dir, 'test-key.pem');
      await Promise.all([writeFile(certPath, certPem), writeFile(keyPath, keyPem)]);
      return { certPath, keyPath };
    },
  };
};

/** A temp directory for a pair the config will name by path. */
export const tempTlsDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'newspa-tls-'));
