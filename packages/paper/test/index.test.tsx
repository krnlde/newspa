import { describe, expect, it } from 'vitest';
import { HealthStrip } from '../src/HealthStrip.tsx';
import type {
  FormatProps,
  HealthLabels,
  HealthProps,
  MastheadProps,
  OnboardingCopy,
  PaperLabels,
  PaperProps,
  SectionProps,
  StoryLabels,
  StoryProps,
  StorySlot,
} from '../src/index.ts';
import * as paper from '../src/index.ts';
import { Masthead } from '../src/Masthead.tsx';
import { Paper } from '../src/Paper.tsx';
import { Section } from '../src/Section.tsx';
import { EditDiff, Story } from '../src/Story.tsx';

/**
 * The barrel is `newspa-paper`'s whole public surface: `apps/web` imports from
 * it, so a rename is a build failure, not a silently blank page. Pinned the way
 * `packages/core/test/index.test.ts` pins core — a declared list of the runtime
 * values, plus a check that the barrel exports **nothing** the list did not
 * declare.
 *
 * Types are erased at runtime, so the type half of the surface is pinned by
 * `PublicTypeSurface` below: it names every type the barrel declares, and a
 * missing name is a typecheck failure.
 */

const COMPONENTS: readonly string[] = ['EditDiff', 'HealthStrip', 'Masthead', 'Paper', 'Section', 'Story'];

/** Every type the barrel declares, in the order `src/index.ts` lists them. */
export type PublicTypeSurface = [
  HealthLabels,
  HealthProps,
  FormatProps,
  MastheadProps,
  SectionProps,
  StoryLabels,
  StoryProps,
  StorySlot,
  OnboardingCopy,
  PaperLabels,
  PaperProps,
];

/**
 * Nothing that formats a date, a time or an age belongs in this package
 * (D-019): the app builds every formatter from i18next's current `language` and
 * hands it in as a prop per render. A barrel that re-grows one of these has
 * frozen a language into the paper.
 */
const BANNED_EXPORTS: readonly string[] = [
  'clockTime',
  'datelineFor',
  'formatFor',
  'publishedFormatter',
  'relativeParts',
  'relativeTime',
];

describe('the paper barrel', () => {
  it('exposes every component, so a rename is a build failure', () => {
    const surface: Record<string, unknown> = { ...paper };
    for (const name of COMPONENTS) {
      expect(surface[name], name).toBeDefined();
      expect(typeof surface[name], name).toBe('function');
    }
  });

  it('exports nothing the barrel did not declare', () => {
    const allowed = new Set(COMPONENTS);
    const extras = Object.keys({ ...paper }).filter((name) => !allowed.has(name));
    expect(extras).toEqual([]);
  });

  it('keeps locale-locked formatters out of the barrel', () => {
    const surface: Record<string, unknown> = { ...paper };
    for (const name of BANNED_EXPORTS) expect(surface[name], name).toBeUndefined();
  });

  it('re-exports the modules themselves, not copies', () => {
    expect(paper.EditDiff).toBe(EditDiff);
    expect(paper.HealthStrip).toBe(HealthStrip);
    expect(paper.Masthead).toBe(Masthead);
    expect(paper.Paper).toBe(Paper);
    expect(paper.Section).toBe(Section);
    expect(paper.Story).toBe(Story);
  });
});
