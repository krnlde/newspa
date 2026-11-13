import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Masthead } from '../src/index.ts';
import { at, one, PART, partsOf, THE_MASTHEAD_PROPS } from './support.ts';

/**
 * The masthead prints four finished strings the app composed (the dateline, the
 * name, the tagline, the stats line) and reflects the theme. It owns no words
 * and no clock: `THE_MASTHEAD_PROPS` is the app's shape, so an assertion here
 * is an assertion that the component renders props and nothing else.
 */

afterEach(cleanup);

const showMasthead = (over: Partial<typeof THE_MASTHEAD_PROPS> = {}) => {
  const onToggleTheme = vi.fn();
  const container = render(<Masthead {...THE_MASTHEAD_PROPS} onToggleTheme={onToggleTheme} {...over} />).container;
  return { container, onToggleTheme };
};

describe('the words', () => {
  it('prints the dateline, the name, the tagline and the summary line, each in its own element', () => {
    const { container } = showMasthead({
      dateline: 'November 9, 2026',
      name: 'The Daily Wires',
      tagline: 'Printed from your own machine',
      summary: '4 stories · 2 new · 1 edited',
    });
    expect(one(PART.dateline, container).textContent).toBe('November 9, 2026');
    expect(one(`h1${PART.title}`, container).textContent).toBe('The Daily Wires');
    expect(one(PART.tagline, container).textContent).toBe('Printed from your own machine');
    expect(one(PART.summary, container).textContent).toBe('4 stories · 2 new · 1 edited');
  });

  it('prints an empty string for an empty one, without inventing words', () => {
    const { container } = showMasthead({ tagline: '', summary: '' });
    expect(one(PART.tagline, container).textContent).toBe('');
    expect(one(PART.summary, container).textContent).toBe('');
  });
});

describe('the exact dates, in the tooltip', () => {
  it('names the edition instant the dateline stands for, and the cache write the stats line stands for', () => {
    const { container } = showMasthead({ cachedAt: at('09:30') });
    expect(one(PART.dateline, container).getAttribute('title')).toBe(`stamp(${THE_MASTHEAD_PROPS.generatedAt})`);
    expect(one(PART.summary, container).getAttribute('title')).toBe(`stamp(${at('09:30')})`);
  });

  it('carries no tooltip on the stats line when the answer came off the wire', () => {
    // `cachedAt: null` is the page saying it is live; `title=""` is a tooltip that
    // says nothing, so the live page prints no attribute.
    expect(one(PART.summary, showMasthead().container).hasAttribute('title')).toBe(false);
  });
});

describe('the theme switcher', () => {
  it('is a real button of type button, so it submits nothing', () => {
    const { container } = showMasthead();
    const button = one<HTMLButtonElement>(PART.themeSwitch, container);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe(THE_MASTHEAD_PROPS.themeLabel);
  });

  it('fires onToggleTheme exactly once per click', () => {
    const { container, onToggleTheme } = showMasthead();
    fireEvent.click(one(PART.themeSwitch, container));
    expect(onToggleTheme).toHaveBeenCalledOnce();
    fireEvent.click(one(PART.themeSwitch, container));
    expect(onToggleTheme).toHaveBeenCalledTimes(2);
  });

  it('is not pressed in light mode, and pressed in dark', () => {
    expect(one(PART.themeSwitch, showMasthead({ theme: 'light' }).container).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(one(PART.themeSwitch, showMasthead({ theme: 'dark' }).container).getAttribute('aria-pressed')).toBe('true');
  });

  it('presses only in dark: a light paper never reports itself pressed', () => {
    const pressed = (['light', 'dark'] as const).map((theme) =>
      one(PART.themeSwitch, showMasthead({ theme }).container).getAttribute('aria-pressed'),
    );
    expect(pressed).toEqual(['false', 'true']);
  });
});

describe('the contrast axis (D-038)', () => {
  const withAxis = (over: Partial<typeof THE_MASTHEAD_PROPS> = {}) =>
    showMasthead({
      contrast: 'more',
      onToggleContrast: vi.fn(),
      contrastLabel: 'Plain',
      ...over,
    });

  it('prints no second control at all when the app has no contrast to offer', () => {
    const { container } = showMasthead();
    expect(container.querySelector(PART.contrastSwitch)).toBeNull();
    expect(container.querySelectorAll(PART.themeSwitch)).toHaveLength(1);
  });

  it('is a real button of type button, labelled by the app', () => {
    const { container } = withAxis();
    const button = one<HTMLButtonElement>(PART.contrastSwitch, container);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe('Plain');
  });

  it('is pressed when the axis is on, and not when it is off: the state, not the label', () => {
    const pressed = (contrast: 'normal' | 'more'): string | null =>
      one(PART.contrastSwitch, withAxis({ contrast }).container).getAttribute('aria-pressed');
    expect(pressed('normal')).toBe('false');
    expect(pressed('more')).toBe('true');
  });

  it('fires onToggleContrast once per press, and never the theme with it', () => {
    const onToggleContrast = vi.fn();
    const { container, onToggleTheme } = withAxis({ onToggleContrast });
    fireEvent.click(one(PART.contrastSwitch, container));
    expect(onToggleContrast).toHaveBeenCalledOnce();
    expect(onToggleTheme).not.toHaveBeenCalled();
  });

  it('prints beside the theme switch, in the page’s one control row', () => {
    const { container } = withAxis();
    const strip = one(PART.datelineStrip, container);
    expect(strip.contains(one(PART.themeSwitch, container))).toBe(true);
    expect(strip.contains(one(PART.contrastSwitch, container))).toBe(true);
  });
});

describe('the install entry (WP16, D-039)', () => {
  const base = { label: 'Install', recipe: 'Share → Add to Home Screen' };

  it('prints a real button when the browser has a prompt in hand, in the strip’s one control row', () => {
    const onInstall = vi.fn();
    const { container } = showMasthead({ install: { mode: 'prompt', ...base, onInstall } });
    const button = one<HTMLButtonElement>(PART.install, container);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe('Install');
    // One control row (D-035: the page has exactly one overlay, and the sources
    // editor is it). The install control joins the strip; it does not add a box.
    expect(one(PART.datelineStrip, container).contains(button)).toBe(true);
    fireEvent.click(button);
    expect(onInstall).toHaveBeenCalledOnce();
    expect(container.querySelector(PART.installRecipe)).toBeNull();
  });

  it('prints the recipe as a line, not a dead button, where the browser offers nothing', () => {
    // iOS Safari has no install event. A control that fires nothing is a lie, and a
    // control that is silently absent is a feature the reader cannot find, so the
    // strip prints the words that work on that browser.
    const { container } = showMasthead({ install: { mode: 'recipe', ...base, onInstall: vi.fn() } });
    expect(one(PART.installRecipe, container).textContent).toBe('Share → Add to Home Screen');
    expect(container.querySelector(PART.install)).toBeNull();
  });

  it('prints nothing when there is nothing to offer, and invents no affordance', () => {
    for (const mode of ['none', 'no-control'] as const) {
      const { container } = showMasthead(mode === 'none' ? { install: { mode, ...base, onInstall: vi.fn() } } : {});
      expect(container.querySelector(PART.install)).toBeNull();
      expect(container.querySelector(PART.installRecipe)).toBeNull();
    }
  });
});

describe('the masthead block', () => {
  it('is one header that prints the dateline strip, then the name, then the tagline, then the stats', () => {
    const header = one(`header${PART.masthead}`, showMasthead().container);
    expect(partsOf(header)).toEqual(['dateline-strip', 'title', 'tagline', 'summary-strip']);
    expect(one(PART.datelineStrip, header).contains(one(PART.dateline, header))).toBe(true);
    expect(one(PART.summaryStrip, header).contains(one(PART.summary, header))).toBe(true);
  });

  it('keeps the switcher in the accessibility tree: a control, not a decorative rule', () => {
    const button = one(PART.themeSwitch, showMasthead().container);
    expect(button.getAttribute('aria-hidden')).toBeNull();
    expect(button.getAttribute('aria-pressed')).not.toBeNull();
  });
});
