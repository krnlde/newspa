import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Masthead } from '../src/index.ts';
import { one, PART, partsOf, THE_MASTHEAD_PROPS } from './support.ts';

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
