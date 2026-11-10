import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * `pnpm sources:init` — a fresh clone has no `sources/`, because D-025 keeps the
 * reading list local and gitignored. This copies the shipped examples in so the
 * paper boots with something to poll.
 *
 * It never overwrites: your own definitions always win, and a re-run is a no-op.
 * Plain JavaScript, no annotations — Node strips types from `.ts`, never from
 * `.mjs` (rule 3), and the scripts run with no build step.
 */

const FROM = 'sources.example';
const TO = 'sources';

const exists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
};

const names = await readdir(FROM).catch(() => []);
const json = names.filter((name) => name.endsWith('.json')).sort();

if (json.length === 0) {
  console.error(`sources:init: ${FROM}/ holds no examples to copy.`);
  process.exit(1);
}

await mkdir(TO, { recursive: true });

const copied = [];
const kept = [];
for (const name of json) {
  const target = path.join(TO, name);
  if (await exists(target)) {
    kept.push(name);
    continue;
  }
  await copyFile(path.join(FROM, name), target);
  copied.push(name);
}

console.log(
  `sources:init: ${String(copied.length)} example source(s) copied into ${TO}/, ${String(kept.length)} already present and left alone.`,
);
if (copied.length > 0) {
  console.log('  these are placeholders: edit the URLs, or delete them and add your own <id>.json.');
}
