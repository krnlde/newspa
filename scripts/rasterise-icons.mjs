import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

/**
 * The install icons, rasterised by the browser this repo already launches
 * (D-039, rule 11: no icon dependency, no image toolchain, no CDN asset).
 *
 * The authored art is `apps/web/public/icons/newspa.svg` — the paper's tab mark:
 * the stock, and the floral heart in the one family the paper owns. This script
 * draws it at each size and writes the PNGs the manifest names. It is in the repo
 * so the icons cannot rot: the art, the sizes and the generator are together, and
 * a manifest entry with no file behind it fails `apps/web/test/unit/manifest.test.ts`.
 *
 * The PNGs are **committed**, so a fresh clone and CI need no browser: this runs
 * when the art changes. One caveat worth knowing, since it is the only thing in
 * the output that depends on the machine: the glyph is text, so its outline comes
 * from the host's Georgia (the same font `index.html`'s favicon asks for). On a
 * machine without it, the fallback's heart differs — regenerate on the machine
 * whose rendering is the paper's, and commit the pair.
 *
 *   node scripts/rasterise-icons.mjs
 */
const SIZES = [192, 512];
const ICON_DIR = 'apps/web/public/icons';
const SOURCE = 'newspa.svg';

/** The PNG's own IHDR: `bytes 16..24` are width and height, big-endian. */
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

// A `file://` image **taints** the canvas, and `toDataURL` then throws a
// SecurityError. A `data:` URL is same-origin, so the SVG travels as text.
const sourceUrl = `data:image/svg+xml;base64,${(await readFile(join(ICON_DIR, SOURCE))).toString('base64')}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    const dataUrl = await page.evaluate(
      async ([url, px]) => {
        const image = new Image();
        await new Promise((resolveLoad, rejectLoad) => {
          image.onload = resolveLoad;
          image.onerror = () => rejectLoad(new Error(`the icon art did not load: ${url.slice(0, 40)}…`));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, px, px);
        // The mark's own share of the tile: pixels far from the stock. The stock is
        // `--paper` (#f4ecd8), so "far" is a distance in channel sums.
        const { data } = ctx.getImageData(0, 0, px, px);
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) {
          const off = Math.abs(data[i] - 244) + Math.abs(data[i + 1] - 236) + Math.abs(data[i + 2] - 216);
          if (off > 40) ink += 1;
        }
        return { dataUrl: canvas.toDataURL('image/png'), mark: ink / (data.length / 4) };
      },
      [sourceUrl, size],
    );
    const bytes = Buffer.from(dataUrl.dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const file = join(ICON_DIR, `newspa-${String(size)}.png`);
    await mkdir(ICON_DIR, { recursive: true });
    await writeFile(file, bytes);
    // Two self-checks, because a canvas that drew nothing still writes a **valid**
    // PNG, and a valid blank PNG installs as a blank tile (rule 5: the generator
    // reports, or it lies). The measured mark is ~9% of the tile.
    const measured = pngSize(bytes);
    if (measured.width !== size || measured.height !== size) {
      throw new Error(
        `${file}: asked for ${String(size)}×${String(size)}, got ${String(measured.width)}×${String(measured.height)}`,
      );
    }
    if (dataUrl.mark < 0.02 || dataUrl.mark > 0.5) {
      throw new Error(
        `${file}: the mark covers ${(dataUrl.mark * 100).toFixed(1)}% of the tile — the art did not render`,
      );
    }
    console.log(
      `${file}: ${String(measured.width)}×${String(measured.height)} PNG, ${(dataUrl.mark * 100).toFixed(1)}% mark, ${String(bytes.length)} bytes`,
    );
  }
} finally {
  await browser.close();
}
