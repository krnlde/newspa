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
      <span data-testid="day">{locale.dayHead(new Date(2026, 10, 8))}</span>
      <span data-testid="count">{locale.count(1234)}</span>
      <span data-testid="time">{locale.time(STAMP)}</span>
      <span data-testid="date">{locale.date(STAMP)}</span>
      <span data-testid="stamp">{locale.stamp(STAMP)}</span>
      <span data-testid="datetime">{locale.dateTime(STAMP)}</span>
      <span data-testid="compact">{locale.compact(12400)}</span>
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
    expect(screen.getByTestId('day').textContent).toContain('November');
    expect(screen.getByTestId('time').textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(screen.getByTestId('date').textContent).toContain('2026');
    expect(screen.getByTestId('datetime').textContent).toContain('2026');
    // The tooltip's formatter: the instant, and the zone it is an instant in.
    expect(screen.getByTestId('stamp').textContent).toMatch(/GMT|UTC/u);
    expect(screen.getByTestId('compact').textContent).toContain('12');
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
        <span data-testid="empty">{`${locale.time(null)}${locale.date('yesterday')}${locale.relative(null, NOW)}`}</span>
      );
    };
    render(<NoStamp />);
    expect(screen.getByTestId('empty').textContent).toBe('');
  });
});
