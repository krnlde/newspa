import { describe, expect, it } from 'vitest';
import { cssOf, isOpaque, px, showPaper } from './support.tsx';

/**
 * The boxes the paper is made of — rails, the edited strip, the health strip,
 * the sticky section label — computed in real Edge. See `support.tsx`.
 * `design-contract.test.tsx` is the type and the front page.
 */

describe('the boxes', () => {
  it('pads every panel and boxes it with an inset ring, never a card', () => {
    showPaper();
    for (const selector of ["[data-part='rail']", "[data-part='edited']", "[data-part='health']"]) {
      const box = cssOf(selector);
      expect(px(box.paddingLeft), `${selector} is flush to its rule`).toBeGreaterThanOrEqual(16);
      expect(px(box.paddingBottom), `${selector} is flush to its rule`).toBeGreaterThanOrEqual(16);
      expect(box.boxShadow, `${selector} has no ring`).toContain('inset');
      expect(box.borderRadius, `${selector} is a card`).toBe('0px');
    }
  });

  it('draws the crossings on the stock and the dot grid on a panel, from one recipe', () => {
    showPaper();
    expect(globalThis.getComputedStyle(document.body).backgroundImage).toContain('repeating-linear-gradient');
    expect(cssOf("[data-part='edited']").backgroundImage).toContain('radial-gradient');
  });

  it('makes a sticky label opaque, so the copy scrolling under it does not show through', () => {
    showPaper();
    const head = cssOf("[data-part='section'] [data-part='block-head']");
    expect(head.position).toBe('sticky');
    expect(isOpaque(head.backgroundColor), `bg-paper computes ${head.backgroundColor}`).toBe(true);
    expect(head.boxShadow).not.toBe('none');
  });

  it('prints the hooks the print rules target, and the sheet on top of the stock', () => {
    showPaper();
    // `@media print` is not reachable from a screen viewport, so the print rules
    // are pinned where they are honest: base.css targets these hooks, and they
    // exist on a real page. The claim is the selector, not the viewport.
    expect(document.querySelectorAll("[data-part='columns']").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-part='headline'] a").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-part='theme-switch']")).not.toBeNull();
    expect(isOpaque(cssOf("[data-part='sheet']").backgroundColor), 'the sheet is a solid panel').toBe(true);
  });
});
