import { chromium } from 'playwright-core';

/**
 * Screenshots the paper at real desktop widths, in the same browser the scraper
 * uses: `playwright-core` + `channel: 'msedge'`, the system Edge, no download
 * (AGENTS.md rule 8).
 *
 * Why this exists: the in-app browser is ~620 px wide, so it always shows the
 * phone stack, and the three-column front page — the layout most likely to be
 * judged — has never been seen. A layout claim that cannot be looked at cannot
 * be reviewed.
 *
 * The dev server must be running with seeded state:
 *
 *   pnpm --filter newspa-web run seed
 *   pnpm --filter newspa-web run dev
 *   node scripts/screenshot-paper.mjs [width height]...
 *
 * Pairs default to 1440x900, 1024x768 and 390x844. `NEWSPA_SHOT_URL` points at
 * another port when 5173 is taken; `NEWSPA_SHOT_DIR` moves the output.
 *
 * Plain JavaScript: `scripts/*.mjs` run with no build step, and Node strips
 * types from `.ts` only (AGENTS.md rule 3).
 */

const OUT_DIR = process.env['NEWSPA_SHOT_DIR'] ?? 'C:/Users/the-k/AppData/Local/Temp/opencode';
const BASE = process.env['NEWSPA_SHOT_URL'] ?? 'http://localhost:5173/';

const pairs = [];
const args = process.argv.slice(2);
for (let i = 0; i + 1 < args.length; i += 2) {
  const w = Number(args[i]);
  const h = Number(args[i + 1]);
  if (Number.isFinite(w) && Number.isFinite(h)) pairs.push([w, h]);
}
if (pairs.length === 0) pairs.push([1440, 900], [1024, 768], [390, 844]);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

for (const [width, height] of pairs) {
  const page = await browser.newPage({ viewport: { width, height } });
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  // The paper is the product: an empty `#root` means the API call failed, and a
  // screenshot of a blank page would be reported as a layout. The hook is
  // `data-part`, never a class name (AGENTS.md rule 11) — a layout claim that
  // queries a styling class is a claim about the styling, not about the page.
  await page.waitForSelector("[data-part='sheet']", { timeout: 15_000 });
  await page.waitForTimeout(250); // fonts and the sticky head settle

  const file = `${OUT_DIR}/newspa-${String(width)}x${String(height)}.png`;
  await page.screenshot({ path: file, fullPage: false });
  const probe = await page.evaluate(() => {
    const front = document.querySelector("[data-part='front']");
    const box = front?.getBoundingClientRect();
    const cols = front ? getComputedStyle(front).gridTemplateColumns : '';
    const justify = [...document.querySelectorAll("[data-part='sheet'] *")].filter(
      (el) => getComputedStyle(el).textAlign === 'justify',
    ).length;
    const headline = document.querySelector("[data-part='story'][data-slot='lead'] [data-part='headline']");
    const size = headline ? getComputedStyle(headline).fontSize : '';
    return {
      cols,
      justify,
      size,
      frontWidth: Math.round(box?.width ?? 0),
      headlineTop: Math.round(headline?.getBoundingClientRect().top ?? 0),
      headlineBottom: Math.round(headline?.getBoundingClientRect().bottom ?? 0),
    };
  });

  // The fold is the claim the screenshots exist to check: a lead photo taller
  // than the viewport pushes the headline off the page, which is the defect this
  // paper has shipped with twice. So it is measured, not looked at.
  const aboveFold = probe.headlineTop >= 0 && probe.headlineBottom <= height;

  console.log(`${width}x${height} -> ${file}`);
  console.log(`  front grid: ${probe.cols}`);
  console.log(`  front width ${String(probe.frontWidth)}px  lead headline ${probe.size}`);
  console.log(
    `  lead headline ${String(probe.headlineTop)}-${String(probe.headlineBottom)}px of ${String(height)}px` +
      `  above the fold: ${aboveFold ? 'yes' : 'NO'}`,
  );
  console.log(`  justified elements: ${String(probe.justify)}`);
  if (failures.length > 0) console.log(`  page problems: ${failures.slice(0, 3).join(' | ')}`);
  await page.close();
}

await browser.close();
