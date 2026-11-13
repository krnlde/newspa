import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initI18n, setLanguage } from '../../src/i18n/index.ts';
import { useLocale } from '../../src/lib/useLocale.ts';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const STAMP = '2026-11-08T10:00:00.000Z';

const Probe = (): React.JSX.Element => {
  const locale = useLocale();
  return (
    <div>
      <span data-testid="relative">{locale.relative(STAMP, NOW)}</span>
      <span data-testid="count">{locale.count(1234)}</span>
      <span data-testid="time">{locale.time(STAMP)}</span>
      <span data-testid="absolute">{locale.absolute(STAMP)}</span>
      <span data-testid="language">{locale.language}</span>
      {/* No `now` argument: the clock default, i.e. the way a component calls it. */}
      <span data-testid="live">{locale.relative(new Date().toISOString())}</span>
    </div>
  );
};

describe('useLocale', () => {
  it('renders every label in the language i18next is set to', async () => {
    await initI18n({ language: 'de' });
    render(<Probe />);
    expect(screen.getByTestId('language').textContent).toBe('de');
    expect(screen.getByTestId('relative').textContent).toBe('vor 2 Stunden');
    expect(screen.getByTestId('count').textContent).toBe('1.234');
    expect(screen.getByTestId('time').textContent).toMatch(/\d{1,2}:\d{2}/);
    // The absolute form: the instant, in the page's language, offset named (D-047).
    expect(screen.getByTestId('absolute').textContent).toContain('2026');
    expect(screen.getByTestId('absolute').textContent).toMatch(/[+-]\d{2}:\d{2}/u);
    expect(screen.getByTestId('absolute').textContent).toContain('um');
    // A stamp from the live clock is a 0-minute delta in the reader's language.
    expect(screen.getByTestId('live').textContent).toBe('gerade eben');
  });

  it('re-renders the formatted text when the language changes, with no remount', async () => {
    const instance = await initI18n({ language: 'de' });
    render(<Probe />);
    expect(screen.getByTestId('relative').textContent).toBe('vor 2 Stunden');
    await act(async () => {
      await setLanguage(instance, 'en');
    });
    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('relative').textContent).toBe('2 hours ago');
    expect(screen.getByTestId('count').textContent).toBe('1,234');
    // The absolute form switches with it, so a language change cannot leave a
    // frozen-language date on the page (D-019).
    expect(screen.getByTestId('absolute').textContent).toContain('at');
  });

  it('says "just now" in the language that is showing, not in English', async () => {
    // A 20-second gap rounds to a 0-minute delta, which core reports as
    // `{ unit: 'minute', delta: 0 }` — the one case `Intl` cannot phrase ("in 0
    // minutes"), so the app's own `time.now` string carries it.
    const instance = await initI18n({ language: 'de' });
    const NowProbe = (): React.JSX.Element => {
      const locale = useLocale();
      return <span data-testid="now">{locale.relative('2026-11-08T11:59:40.000Z', NOW)}</span>;
    };
    render(<NowProbe />);
    expect(screen.getByTestId('now').textContent).toBe('gerade eben');
    await act(async () => {
      await setLanguage(instance, 'en');
    });
    expect(screen.getByTestId('now').textContent).toBe('just now');
  });

  it('is empty, not "Invalid Date", for a story with no timestamp', async () => {
    await initI18n({ language: 'en' });
    const NoStamp = (): React.JSX.Element => {
      const locale = useLocale();
      return (
        <span data-testid="empty">{`${locale.time(null)}${locale.absolute('yesterday')}${locale.relative(null, NOW)}`}</span>
      );
    };
    render(<NoStamp />);
    expect(screen.getByTestId('empty').textContent).toBe('');
  });
});
