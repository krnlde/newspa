import type { CSSProperties } from 'react';
import type { SpineProps } from './types.ts';

/**
 * The spine (D-043): the sections as **squares on a rail over the scrollbar**,
 * where the rail is the page's own **submenu**.
 *
 * The shape is the reader's ruling, four times over, and every part of it came
 * from reading the live page and saying what was wrong.
 *
 *  - **squares, not lines.** The first build drew a hairline tick, a guideline and
 *    a printer's registration mark; the reader read them as debug marks and as
 *    something no thumb could hit. So the rail draws squares of ink and nothing
 *    else, each inside a box a pointer can find.
 *  - **a place on the rail is one y.** The front page prints WORLD, TOP STORIES
 *    and POLITICS in one row, so those heads share a document position. The first
 *    build pushed colliding marks apart by a pitch and drew a column of three
 *    squares where the page has one row. Now the sections of one place sit **side
 *    by side in one cluster**, and no section is ever dropped.
 *  - **the titles appear, and there is no menu.** Hovering — or focusing, the
 *    keyboard's and the pen's way — expands the cluster: each square leaves the
 *    row, drops down the rail, and grows its own title out to the left, in the
 *    deck's volume. A **`--i`** is the row's index, and `spine.css` animates the
 *    place and the width, so the row becomes a list while the words run out beside
 *    it. There is no panel, no dialog, no scrim: D-035's one-overlay law is
 *    untouched, because the spine adds no overlay at all.
 *  - **the title is the link, and it goes to the section's position.** The square
 *    and its word are **one anchor**, `<a href="#section-world">`, so a click on
 *    the mark and a click on the word are the same jump, the URL keeps the
 *    section, the back button works, and a device with no JavaScript has a rail of
 *    links. No script is in this file, and none is needed for the behaviour: the
 *    reveal is `:hover` and `:focus-within`, the motion is a transition, and
 *    `base.css` stills it for a reader who asked for less.
 *
 * The square's name is the section's own word, which is why the paper needs no
 * words of its own here (D-019): an anchor's accessible name is its text, and its
 * text is the publisher's title. Only the rail's own name is the app's, and it
 * arrives as a prop.
 *
 * `apps/web/src/spine.ts` supplies the one number CSS cannot read: each place's
 * fraction of the document, and which section the reader is in
 * (`IntersectionObserver`).
 */

/**
 * A CSS custom property in a `style` object.
 *
 * React's `CSSProperties` types the properties it knows, and a custom property is
 * not one of them, so the pair is **declared** — `Record<`--${string}`, string>`
 * is the type of "a CSS custom property", not an escape hatch (rule 2 bans `any`,
 * and a name is the difference between a shape and a shrug).
 */
type StyleVars = CSSProperties & Record<`--${string}`, string>;

/** One place on the rail, as a fraction of it. */
const clusterStyle = (at: number): StyleVars => ({ '--at': String(at) });

/**
 * One section's place **within** its cluster: the index that both layouts read.
 * `spine.css` puts index `i` at `i` × `--spine-pitch` along the row at rest and at
 * `i` × `--spine-tap` down the rail when the cluster is open, and transitions
 * between them — which is the whole of the animation, with no script in the loop.
 */
const markStyle = (index: number): StyleVars => ({ '--i': String(index) });

export const Spine = ({ groups, railLabel }: SpineProps) => (
  <div data-part="spine">
    <nav data-part="spine-rail" aria-label={railLabel}>
      {groups.map((group) => (
        <div key={group.marks[0]?.id ?? ''} data-part="spine-cluster" style={clusterStyle(group.at)}>
          {group.marks.map((mark, index) => (
            <a
              key={mark.id}
              data-part="spine-mark"
              data-active={mark.active ? 'true' : 'false'}
              href={`#${mark.id}`}
              style={markStyle(index)}
            >
              {/* The word, then the square: the word is clipped away at rest and
                  slides out of the rail when the cluster opens, and the square stays
                  at the rail's edge in both shapes. */}
              <span data-part="spine-label">{mark.title}</span>
              <span data-part="spine-square" aria-hidden="true" />
            </a>
          ))}
        </div>
      ))}
    </nav>
  </div>
);
