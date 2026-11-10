import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { boxOf, cssOf, paperElements, px, showPaper, tracks, widthOf } from './support.tsx';

/**
 * The type and the front page, computed in real Edge: see `support.tsx` for the
 * edition, the viewport story and why happy-dom cannot check any of this.
 * `boxes.test.tsx` is the panels; `design-contract` owns the guard that proves
 * the sheet is compiled before any of it means anything.
 */

describe('the paper is styled by its own CSS', () => {
  it('compiles the utilities, so nothing below is a scan of nothing', () => {
    showPaper();
    expect(
      cssOf("[data-part='section'] [data-part='block-head']").position,
      'the design project serves no compiled Tailwind: a Vitest project inherits no Vite plugin from the root config, so `apps/web/vitest.design.config.ts` must list `tailwindcss()` itself — without it `@import "tailwindcss"` reaches the browser as literal text and every utility computes to its initial value, which makes every measurement below a scan of nothing',
    ).toBe('sticky');
    expect(paperElements().length).toBeGreaterThan(40);
  });
});

describe('the text', () => {
  it('never justifies, at 1440, 1024 and 390', async () => {
    for (const width of [1440, 1024, 390]) {
      showPaper();
      await page.viewport(width, 900);
      const rivering = paperElements().filter((node) => globalThis.getComputedStyle(node).textAlign === 'justify');
      expect(
        rivering.map((node) => node.getAttribute('data-part')),
        `${String(width)}px`,
      ).toEqual([]);
      cleanup();
    }
  });

  it('sets the lead headline in the one family the paper owns, with no download', () => {
    showPaper();
    expect(cssOf("[data-part='story'][data-slot='lead'] [data-part='headline']").fontFamily).toMatch(/Georgia/u);
  });
});

describe('the front page', () => {
  it('is three columns at 1440, with the lead column wider than either rail', async () => {
    showPaper();
    await page.viewport(1440, 900);
    expect(tracks("[data-part='front']")).toHaveLength(3);
    const lead = widthOf("[data-part='lead']");
    const rail = widthOf("[data-part='rail']");
    expect(lead).toBeGreaterThan(rail);
  });

  it('is one column at 900: three screens of scrolling rails is not a paper', async () => {
    showPaper();
    await page.viewport(900, 900);
    expect(tracks("[data-part='front']")).toHaveLength(1);
    /*
     * What the stack must guarantee is that nothing sits beside the lead. The
     * lead's own measure cap (46rem, kept from the sheet, where it was
     * `max-width: 46rem; margin: 0 auto`) survives the breakpoint on purpose: a
     * display headline of ~11 characters per line is the whole point of the lead,
     * and stretching it to the rail's width at 900px would widen the measure
     * rather than stack the page. So: one track, the lead no wider than a rail,
     * and the lead measured — a capped box, not a collapsed one.
     */
    const rail = widthOf("[data-part='rail']");
    const lead = widthOf("[data-part='lead']");
    expect(lead).toBeGreaterThan(0);
    expect(lead).toBeLessThanOrEqual(rail);
  });

  it('keeps the lead headline above the fold at 1440x900, and the photo under it', async () => {
    showPaper();
    await page.viewport(1440, 900);
    const headline = boxOf("[data-part='story'][data-slot='lead'] [data-part='headline']");
    expect(Math.round(headline.bottom)).toBeLessThanOrEqual(900);
    expect(Math.round(boxOf("[data-part='story'][data-slot='lead'] [data-part='figure']").top)).toBeGreaterThanOrEqual(
      Math.round(headline.bottom) - 1,
    );
  });

  it('caps the lead photo, so an index page does not open as a blog', async () => {
    showPaper();
    await page.viewport(1440, 900);
    const height = Math.round(boxOf("[data-part='story'][data-slot='lead'] [data-part='image']").height);
    expect(height).toBeLessThanOrEqual(241);
    expect(height).toBeGreaterThan(80);
  });

  it('separates rail items with a hairline, and prints none before the first', async () => {
    showPaper();
    await page.viewport(1440, 900);
    const items = [...document.querySelectorAll<HTMLElement>("[data-part='rail'][data-side='left'] li")];
    expect(items.length).toBeGreaterThan(1);
    const rules = items.map((node) => px(globalThis.getComputedStyle(node).borderTopWidth));
    expect(rules[0]).toBe(0);
    expect(rules[1]).toBeGreaterThan(0);
  });
});
