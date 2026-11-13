import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The install manifest, read as the browser reads it (WP16, D-039).
 *
 * This is the acceptance the roadmap asked for: **the manifest names the icons
 * that exist.** A manifest entry with no file behind it is not a broken build -
 * it is an install that offers a blank tile, in a product whose whole claim is
 * being a device that shows the paper. So every `src` is opened here, and a PNG
 * is checked against its own IHDR, because `"sizes": "512x512"` on a 192-pixel
 * file parses fine, installs, and the OS shrinks it.
 *
 * The colours are pinned to the paper's own tokens: `--paper` and `--ink` are
 * owned by `packages/paper/styles/tokens.css` (rule 11, one owner per value),
 * and the manifest is a static file that cannot read them. A drift here is a
 * home-screen tile in a colour the page does not use.
 *
 * The paths come from **node:url**'s own `URL`: this project's environment is
 * happy-dom, which puts its own `URL` on the global, and `readFile(new URL(…))`
 * then opens a file named `undefined` - measured on this file's first run. The
 * server suite's `boundary.test.ts` carries the same note for the same reason.
 */
const at = (relative: string): string => fileURLToPath(new NodeUrl(relative, import.meta.url));
const read = (relative: string): Promise<string> => readFile(at(relative), 'utf8');

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly id: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly icons: readonly ManifestIcon[];
}

const manifestOf = async (): Promise<Manifest> =>
  JSON.parse(await read('../../public/manifest.webmanifest')) as Manifest;

/** The PNG header: 8 signature bytes, then `IHDR`, then width and height, big-endian. */
const pngSize = (bytes: Buffer): { width: number; height: number } => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

const tokenOf = async (name: string): Promise<string> => {
  const css = await read('../../../../packages/paper/styles/tokens.css');
  const found = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(css);
  if (found === null) throw new Error(`tokens.css declares no --${name}`);
  return (found[1] as string).toLowerCase();
};

describe('the install manifest', () => {
  it('installs the paper as an app, on its own scope, from a clean url', async () => {
    // `standalone` is the decision (D-039: the product is a device that shows the
    // paper, not a tab). `scope: "/"` matters as much: without it, a reader who
    // adds the wall url to a home screen gets an app that leaves itself the moment
    // a story link is followed. And no query in `start_url`: the D-037 kiosk axes
    // arrive by url, and an install that bakes one in pins a device to someone
    // else's display choice.
    const manifest = await manifestOf();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.id).toBe('/');
    expect(manifest.name.length).toBeGreaterThan(0);
    // The launcher's label: longer than this is truncated on a phone, and a
    // truncated word is a product the reader cannot name.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('names icons that exist, of the size it claims, with no CDN asset', async () => {
    const manifest = await manifestOf();
    expect(manifest.icons.filter((icon) => icon.type === 'image/png').length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      // Rule 11: no CDN asset. Every icon is the bundle's own file.
      expect(icon.src.startsWith('/'), `${icon.src} is not the bundle's own`).toBe(true);
      const bytes = await readFile(at(`../../public${icon.src}`));
      expect(bytes.length, `${icon.src} is empty`).toBeGreaterThan(0);
      if (icon.type === 'image/png') {
        expect(bytes.subarray(0, 8).toString('hex'), `${icon.src} is not a PNG`).toBe('89504e470d0a1a0a');
        const size = pngSize(bytes);
        expect(`${String(size.width)}x${String(size.height)}`, `${icon.src} is not ${icon.sizes}`).toBe(icon.sizes);
      }
    }
  });

  it('gives a maskable icon the safe zone a maskable icon needs', async () => {
    // A maskable icon is one an OS cuts a circle, or squircle, out of, keeping only
    // the central 80%. The authored art decides that, so the measurement is the
    // authored number: the glyph's em-box against the canvas - 320 of 512, 62.5%,
    // centred. Comfortably inside, which is why one square serves `any` and
    // `maskable` and the repo ships no second drawing.
    const manifest = await manifestOf();
    const maskable = manifest.icons.filter(
      (icon) => (icon.purpose ?? '').includes('maskable') && icon.type === 'image/png',
    );
    expect(maskable.length, 'no maskable PNG').toBeGreaterThan(0);
    for (const icon of maskable) {
      const size = pngSize(await readFile(at(`../../public${icon.src}`)));
      expect(size.width, `${icon.src} is not square`).toBe(size.height);
      expect(size.width).toBeGreaterThanOrEqual(192);
    }
    const svg = await read('../../public/icons/newspa.svg');
    const canvas = /viewBox="0 0 (\d+) (?:\d+)"/.exec(svg);
    const glyph = /font-size="(\d+)"/.exec(svg);
    expect(canvas, 'the icon art has no square viewBox').not.toBeNull();
    expect(Number(glyph?.[1]) / Number(canvas?.[1])).toBeLessThanOrEqual(0.8);
    expect(svg).toContain('text-anchor="middle"');
  });

  it("paints the tile in the paper's own colours, not a copy of them", async () => {
    const manifest = await manifestOf();
    const paper = await tokenOf('paper');
    const ink = await tokenOf('ink');
    expect(manifest.theme_color.toLowerCase()).toBe(paper);
    expect(manifest.background_color.toLowerCase()).toBe(paper);
    const svg = await read('../../public/icons/newspa.svg');
    expect(svg).toContain(paper);
    expect(svg).toContain(ink);
  });

  it('is linked from the page, which is the only way a browser finds it', async () => {
    const html = await read('../../index.html');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.webmanifest"');
    // iOS ignores the manifest's icons; it reads this link (D-039: iOS gets the
    // named recipe, and a recipe is worth an icon).
    expect(html).toContain('rel="apple-touch-icon"');
    const touch = /rel="apple-touch-icon" href="([^"]+)"/.exec(html);
    expect(touch, 'the apple-touch-icon link has no href').not.toBeNull();
    const bytes = await readFile(at(`../../public${touch?.[1]}`));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
