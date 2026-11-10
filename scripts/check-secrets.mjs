import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Fails the build when a committed file carries a credential.
 *
 * The posture this guards (docs/decisions.md D-023): the paper authenticates with
 * **your own browser** - `pnpm login` writes an Edge profile under `profiles/`,
 * which is gitignored - and the state store is a `node:sqlite` file under `data/`,
 * which needs no authentication at all. Nothing in the repository is supposed to
 * be able to authenticate anything to anyone, so a credential appearing in a
 * tracked file is a design violation, not merely a leak.
 *
 * Scope is deliberately narrow and boring: exact shapes of the tokens that
 * matter at error severity, public-by-design values at warning severity. A
 * scanner that cries wolf gets bypassed within a week, which is worse than no
 * scanner at all. `pk_live_…` is therefore a warning: a Stripe publishable key
 * ships to every visitor's browser, and the half that matters, `sk_live_`, fails.
 *
 * Fixtures are exempt, for the same reason rule 1 exempts them from the 300-line
 * cap: `packages/fetch/test/fixtures/**` are third-party payloads captured byte
 * for byte, and editing one to satisfy a scanner destroys the only proof that the
 * parser handles what the real site sent. The CNN fixture carries CNN's own
 * publishable key and the jwt.io example header for exactly that reason. Capture
 * fixtures **logged out**: the exemption is symmetric, and a payload from a
 * signed-in page carries the reader's data into a public file.
 *
 * Plain JavaScript, no annotations: Node strips types from `.ts`, never from
 * `.mjs`, and the scripts run with no build step (rule 3).
 */

const EXEMPT = [
  (file) => file.includes('/fixtures/'),
  (file) => file === 'pnpm-lock.yaml',
  (file) => /^(coverage|dist)(\/|$)/.test(file),
  (file) => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.webp'),
  (file) => file.endsWith('.woff2') || file.endsWith('.sqlite') || file.endsWith('.db'),
];

const RULES = [
  {
    label: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'error',
    why: 'grants access to an AWS account',
  },
  {
    label: 'GitHub token',
    pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/,
    severity: 'error',
    why: 'grants repository and API access',
  },
  {
    label: 'GitHub fine-grained PAT',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{16,}\b/,
    severity: 'error',
    why: 'grants repository access',
  },
  { label: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/, severity: 'error', why: 'grants GitLab access' },
  {
    label: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    severity: 'error',
    why: 'grants a Slack workspace',
  },
  {
    label: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
    severity: 'error',
    why: 'billable calls against a Google API quota',
  },
  { label: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, severity: 'error', why: 'billable API access' },
  {
    label: 'Stripe secret key',
    pattern: /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/,
    severity: 'error',
    why: 'full account access, including charges',
  },
  {
    label: 'Private key block',
    pattern: /BEGIN [A-Z ]*PRIVATE KEY/,
    severity: 'error',
    why: 'the key itself, in plain text',
  },
  {
    label: 'Basic-auth URL',
    pattern: /https?:\/\/[^/\s@]+:[^/\s@]{6,}@/,
    severity: 'error',
    why: 'a username and password inside a URL',
  },
  {
    label: 'Authorization header',
    pattern: /["']authorization["']\s*:\s*["'][^"']{8,}["']/i,
    severity: 'error',
    why: 'sources/*.json is committed, so this commits the credential with it - use pnpm login and an Edge profile',
  },
  {
    label: 'Bearer token',
    pattern: /\bBearer\s+[A-Za-z0-9._+/-]{24,}={0,2}/,
    severity: 'error',
    why: 'a live bearer token',
  },
  {
    label: 'Cookie header',
    pattern: /["']cookie["']\s*:\s*["'][^"']{12,}["']/i,
    severity: 'error',
    why: 'a session cookie in a committed file',
  },
  {
    label: 'Stripe publishable key',
    pattern: /\bpk_live_[A-Za-z0-9]{16,}\b/,
    severity: 'warn',
    why: 'public by design (every browser receives it). Not a leak; reported so a stranger running a scanner gets an answer.',
  },
  {
    label: 'jwt.io example header',
    pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./,
    severity: 'warn',
    why: 'documentation scaffolding from jwt.io, not a session token',
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter((file) => file.length > 0);

/**
 * Path rules: files that must never be tracked, whatever their contents. A
 * source definition is a statement about what the reader cares about (URL set,
 * watchwords, section labels, notes), and this repository is public, so
 * `sources/` is gitignored by D-025. The content scan below cannot catch that:
 * the file is innocuous, the *fact that it is published* is the leak.
 */
const TRACKED_PATH_RULES = [
  {
    pattern: /^sources(\/|$)/,
    label: 'tracked source definition',
    why: 'the reading list is local - ship sources.example/, never sources/ (AGENTS rule 18, D-025)',
  },
];

const findings = [];
const warnings = [];
let scanned = 0;
let exempt = 0;

for (const file of tracked) {
  for (const rule of TRACKED_PATH_RULES) {
    if (rule.pattern.test(file)) findings.push(`${file}  ${rule.label} - ${rule.why}`);
  }
}

for (const file of tracked) {
  if (EXEMPT.some((test) => test(file))) {
    exempt += 1;
    continue;
  }
  let text;
  try {
    text = readFileSync(file, 'latin1');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary: there is no text credential to read
  scanned += 1;
  const lines = text.split(/\r?\n/);
  for (const rule of RULES) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (!rule.pattern.test(line)) continue;
      const message = `${file}:${String(index + 1)}  ${rule.label} - ${rule.why}`;
      if (rule.severity === 'error') findings.push(message);
      else warnings.push(message);
    }
  }
}

for (const warning of warnings) console.warn(`  warning  ${warning}`);

if (findings.length > 0) {
  console.error(`\nsecrets: ${findings.length} finding(s) in ${scanned} tracked file(s)\n`);
  for (const finding of findings) console.error(`  ${finding}\n`);
  console.error(
    '  This design needs no committed credential: pnpm login writes an Edge profile under\n' +
      '  profiles/ (gitignored), and the state store is a local node:sqlite file under\n' +
      '  data/ (gitignored). Remove the value, then rotate it if it was ever real - a\n' +
      '  secret that reached a public commit is public, even after a squash.\n',
  );
  process.exit(1);
}

console.log(
  `secrets: ${scanned} tracked file(s) clean, ${exempt} exempt (fixtures, lockfile, binaries)` +
    (warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''),
);
