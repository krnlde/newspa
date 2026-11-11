/**
 * The inspector: the part of the picker that runs **in the page** (WP6, D-036).
 *
 * It is a string of plain ES2019, injected into a real browser, because that is
 * the only form `addInitScript` accepts — no import, no bundler, no `this`. It is
 * written to mirror DevTools' "Select an element to inspect it", which is the
 * affordance the reader already knows: hover rings one element and names it, a
 * click captures it, **Up/Down walk the ancestor chain**, Esc cancels. The arrow
 * step is not a luxury: a click lands on a `<span>` inside the card, and the
 * parent step is what turns that into a pick of the card.
 *
 * What it sends is a **fingerprint**, never a selector: the nth-child path from
 * `<html>`, the nearest `a[href]`, the node's markup and text, and the sibling
 * count. The page is a witness, not an author — the selector is derived in Node,
 * against the bytes the poller fetches (`derivePick.ts`), which is what makes
 * D-007's trap measurable at pick time.
 *
 * Two rules of a tool that lives on a stranger's page, both measured risks:
 *
 *  - **it must not steer the page.** The click is captured on `document` in the
 *    capture phase and cancelled, so a card's own navigation, its `mousedown`
 *    handler, and its analytics never fire;
 *  - **it must not be styled by the page.** The overlay carries no class name and
 *    every property is inline, so a publisher's `.box`, `.card` or `.label`
 *    cannot reach it; `pointer-events: none` keeps it from swallowing the hover.
 *
 * The binding name is one constant, shared with `launch.ts`: the payload is
 * `unknown` on arrival and `parseFingerprint` is what decides it.
 *
 * The source is a **template literal**, so nothing inside it can contain a
 * backtick: the comments in the page code are written in prose, not in `code`
 * spans. That is a parse error, measured, not a style preference.
 */

/** The `window` binding the page reports through. A `null` payload means "cancelled". */
export const PICK_BINDING = 'newspaPick';

/** The init script that arms the inspector on every page of the pick session. */
export const INSPECTOR_SOURCE = `(() => {
  const BINDING = '${PICK_BINDING}';
  const OWNER = 'newspa-pick';
  if (window.__newspaInspectorArmed === true) return;
  window.__newspaInspectorArmed = true;

  let depth = 0;
  let base = null;
  let box = null;
  let tag = null;
  const climb = (node, up) => {
    let current = node;
    for (let i = 0; i < up && current && current.parentElement; i += 1) current = current.parentElement;
    return current;
  };
  const paint = () => {
    if (!box) return;
    if (!base) {
      box.style.display = 'none';
      return;
    }
    const node = climb(base, depth);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = String(rect.left + window.scrollX) + 'px';
    box.style.top = String(rect.top + window.scrollY) + 'px';
    box.style.width = String(rect.width) + 'px';
    box.style.height = String(rect.height) + 'px';
    const classes = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    const named = node.tagName.toLowerCase() + (classes.length > 0 ? '.' + classes.join('.') : '');
    tag.textContent = depth > 0 ? named + ' ↑' + String(depth) : named;
  };
  const install = () => {
    if (box) return;
    box = document.createElement('div');
    box.dataset.newspa = OWNER;
    box.style.cssText =
      'position:absolute;z-index:2147483647;pointer-events:none;display:none;' +
      'outline:2px solid #0b3d91;outline-offset:-1px;background:rgba(11,61,145,0.14)';
    tag = document.createElement('div');
    tag.dataset.newspa = OWNER;
    tag.style.cssText =
      'position:fixed;left:0;bottom:0;z-index:2147483647;pointer-events:none;' +
      'font:12px/1.4 ui-monospace,Consolas,monospace;color:#0b3d91;background:#ffffe8;' +
      'padding:2px 6px;border:1px solid #0b3d91;max-width:60vw;white-space:nowrap;overflow:hidden';
    document.documentElement.append(box, tag);
  };
  const pathOf = (node) => {
    const steps = [];
    let current = node;
    while (current && current.nodeType === 1) {
      const parent = current.parentElement;
      const index = parent ? Array.prototype.indexOf.call(parent.children, current) + 1 : 1;
      steps.unshift({ tag: current.tagName.toLowerCase(), index });
      current = parent;
    }
    return steps;
  };
  const fingerprintOf = (node) => {
    // 'closest' is the node and its ancestors; the story link of a card is a
    // descendant. Measured in real Edge: picking the li (the parent step, after two
    // Up presses) reported a null href while the card's anchor was right there, so
    // the evidence the reader is shown was missing. Ancestor first, because the
    // anchor IS the card on CNN's lite shape, then the subtree.
    const anchor = node.closest('a[href]') || node.querySelector('a[href]');
    const parent = node.parentElement;
    return {
      url: window.location.href,
      path: pathOf(node),
      href: anchor === null || anchor === undefined ? null : anchor.href,
      outerHtml: node.outerHTML,
      text: (node.innerText || node.textContent || '').trim(),
      siblings: parent ? parent.children.length : 1,
    };
  };
  const report = (payload) => {
    const send = window[BINDING];
    if (typeof send !== 'function') return;
    void send(payload);
  };
  const pick = (node) => {
    report(fingerprintOf(node));
  };
  const onMove = (event) => {
    install();
    base = document.elementFromPoint(event.clientX, event.clientY);
    if (base === document.documentElement || base === document.body) depth = 0;
    paint();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      report(null);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      depth = Math.max(0, depth + (event.key === 'ArrowUp' ? 1 : -1));
      paint();
      return;
    }
    if (event.key === 'Enter' && base !== null) {
      event.preventDefault();
      pick(climb(base, depth));
    }
  };
  const onClick = (event) => {
    if (base === null) return;
    event.preventDefault();
    event.stopPropagation();
    pick(climb(base, depth));
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, true);
  window.__newspaPickAt = (selector) => {
    install();
    const found = document.querySelector(selector);
    if (found === null) return false;
    base = found;
    depth = 0;
    paint();
    pick(found);
    return true;
  };
  tag.textContent = 'newspa pick: hover, click to capture, ↑/↓ parent, Esc to stop';
  tag.style.display = 'block';
})();`;
