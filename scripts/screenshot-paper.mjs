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
 * Pairs default to 1440x900, 1024x768, 620x800 and 390x844 — 620 because that is
 * the width of the in-app browser, which is where a reader looks first and where
 * a 6px horizontal scrollbar showed up. `NEWSPA_SHOT_URL` points at another port
 * when 5173 is taken; `NEWSPA_SHOT_DIR` moves the output.
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
if (pairs.length === 0) pairs.push([1440, 900], [1024, 768], [620, 800], [390, 844]);

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
    // The waste area: the sheet is a page lying on patterned stock, so the stock
    // must be visible and the crop marks — drawn 7px outside the sheet's box —
    // must land inside the viewport. A full-bleed sheet hides the crossings
    // behind its own `bg-paper` and pushes the marks past the right edge.
    const sheet = document.querySelector("[data-part='sheet']")?.getBoundingClientRect();
    // `clientWidth`, not `innerWidth`: the vertical scrollbar is not page, and
    // the comparison must be against the width the layout gets.
    const vw = document.documentElement.clientWidth;
    return {
      cols,
      justify,
      size,
      stockLeft: Math.round(sheet?.left ?? 0),
      stockRight: Math.round(vw - (sheet?.right ?? 0)),
      overflowX: document.documentElement.scrollWidth - vw,
      gutter: getComputedStyle(document.body).paddingInlineStart,
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
  /*
   * The waste area, with a number: the stock shows on both sides of the sheet,
   * and the page does not scroll sideways. Both were measured false before
   * `body`'s padding existed — visible stock 0 px² at every width, and 6px of
   * horizontal overflow from the crop marks drawn outside the box. "The pattern
   * is in the stylesheet" was true; "the reader sees it" was not.
   */
  console.log(
    `  stock: ${String(probe.stockLeft)}px + ${String(probe.stockRight)}px (gutter ${probe.gutter})` +
      `  sideways scroll: ${probe.overflowX > 0 ? `${String(probe.overflowX)}px — NO` : 'none'}`,
  );
  if (probe.overflowX > 0) failures.push(`page scrolls sideways by ${String(probe.overflowX)}px`);
  if (failures.length > 0) console.log(`  page problems: ${failures.slice(0, 3).join(' | ')}`);
  await page.close();
}

await browser.close();
