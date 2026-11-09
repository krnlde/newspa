import { execFileSync } from 'node:child_process';

/**
 * Fails when the published-schema constants describe a repository that is not
 * this one.
 *
 * Why: `SCHEMA_OWNER` was written as `krnl` from an assumption, before the
 * GitHub repository existed. The result was every exported `$schema` pointing at
 * a 404 - an editor never resolved a schema, and nothing downstream noticed,
 * because the URL is a string the tests happily assert against itself. The test
 * pins the value; it cannot tell you the value is wrong.
 *
 * The remote can. Parsing `git remote get-url origin` is offline, deterministic
 * and ~20 ms, and it is the only place the real owner/repo lives.
 *
 * The branch is deliberately NOT compared: `SCHEMA_BRANCH` is where the published
 * schemas are read from (`main`), and a feature branch is expected to differ, so
 * comparing it would fail on the common case and hide the one that matters.
 */

// A URL object, not a path: on Windows `import('C:\\…')` throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME, because the ESM loader only takes file: URLs.
const SCHEMA_URLS = new URL('../packages/config/src/schemaUrls.ts', import.meta.url);

const githubRemote = () => {
  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
  const ssh = /^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/.exec(url);
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(\.git)?$/.exec(url);
  const match = ssh ?? https;
  if (match === null) return { url, owner: null, repo: null };
  return { url, owner: match[1], repo: match[2] };
};

const { SCHEMA_OWNER, SCHEMA_REPO } = await import(SCHEMA_URLS);
const remote = githubRemote();

if (remote === null) {
  console.log(`repo identity: no origin remote, so owner/repo (${SCHEMA_OWNER}/${SCHEMA_REPO}) is unchecked`);
  process.exit(0);
}

if (remote.owner === null) {
  console.log(`repo identity: origin is not a GitHub URL (${remote.url}), so owner/repo is unchecked`);
  process.exit(0);
}

if (remote.owner === SCHEMA_OWNER && remote.repo === SCHEMA_REPO) {
  console.log(`repo identity: ${SCHEMA_OWNER}/${SCHEMA_REPO} matches origin`);
  process.exit(0);
}

console.error('published-schema constants do not describe this repository\n');
console.error(`  origin is  ${remote.owner}/${remote.repo}   (git remote get-url origin)`);
console.error(`  schemaUrls.ts says  ${SCHEMA_OWNER}/${SCHEMA_REPO}\n`);
console.error(
  '  Every exported $schema therefore resolves to a URL that does not exist,\n' +
    '  and the test suite cannot see it: it asserts the constant against itself.\n' +
    '  Fix packages/config/src/schemaUrls.ts, then run pnpm schemas:gen.\n',
);
process.exit(1);
