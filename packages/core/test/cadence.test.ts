import { describe, expect, it } from 'vitest';
import type { RelaxInput } from '../src/cadence.ts';
import {
  CADENCE_PRESETS,
  describeCadence,
  effectiveCadenceMinutes,
  inQuietHours,
  isKnownCadence,
  MAX_CADENCE_MINUTES,
  MIN_CADENCE_MINUTES,
  MIN_RENDERED_CADENCE_MINUTES,
} from '../src/cadence.ts';

const at = (hour: number): Date => new Date(2026, 10, 9, hour, 0, 0);

describe('CADENCE_PRESETS', () => {
  it('labels are derived from the numbers they name', () => {
    for (const preset of CADENCE_PRESETS) {
      expect(describeCadence(preset.minutes), preset.label).toBe(preset.label);
    }
  });

  it('marks only the fast tiers as safe for a plain fetch', () => {
    expect(CADENCE_PRESETS.filter((preset) => preset.fastTier).map((preset) => preset.minutes)).toEqual([
      1, 2, 5, 15, 30, 60,
    ]);
    expect(MIN_CADENCE_MINUTES).toBe(1);
    expect(MAX_CADENCE_MINUTES).toBe(10_080);
    expect(MIN_RENDERED_CADENCE_MINUTES).toBe(5);
  });
});

describe('describeCadence', () => {
  it('reads minutes, hours and days in the unit a reader would use', () => {
    expect(describeCadence(45)).toBe('45 min');
    expect(describeCadence(120)).toBe('2 hours');
    expect(describeCadence(90)).toBe('1.5 hours');
    expect(describeCadence(2160)).toBe('1.5 days');
    expect(describeCadence(2880)).toBe('2 days');
    expect(describeCadence(10_081)).toBe('7.0 days');
    expect(describeCadence(1441)).toBe('1.0 days');
  });

  it('prefers the preset label when the value is a preset', () => {
    expect(describeCadence(60)).toBe('1 hour');
    expect(describeCadence(720)).toBe('12 hours');
    expect(describeCadence(1440)).toBe('daily');
    expect(describeCadence(10_080)).toBe('weekly');
  });
});

describe('isKnownCadence', () => {
  it('accepts whole minutes inside the bounds only', () => {
    expect(isKnownCadence(1)).toBe(true);
    expect(isKnownCadence(10_080)).toBe(true);
    expect(isKnownCadence(0)).toBe(false);
    expect(isKnownCadence(-1)).toBe(false);
    expect(isKnownCadence(10_081)).toBe(false);
    expect(isKnownCadence(2.5)).toBe(false);
  });
});

describe('effectiveCadenceMinutes', () => {
  it('returns the configured cadence on a success or before the first failure', () => {
    const input = (over: Partial<RelaxInput>): number =>
      effectiveCadenceMinutes({ cadenceMinutes: 20, attempts: 0, state: 'error', capMinutes: 1440, ...over });
    expect(input({ state: 'ok', attempts: 3 })).toBe(20);
    expect(input({ attempts: 0 })).toBe(20);
  });

  it('multiplies the interval by four per consecutive failure', () => {
    const input = (attempts: number): number =>
      effectiveCadenceMinutes({ cadenceMinutes: 20, attempts, state: 'blocked', capMinutes: 1440 });
    expect(input(1)).toBe(80);
    expect(input(2)).toBe(320);
    expect(input(3)).toBe(1280);
  });

  it('caps the factor at four attempts, and the result at the cap', () => {
    expect(effectiveCadenceMinutes({ cadenceMinutes: 20, attempts: 9, state: 'blocked', capMinutes: 100_000 })).toBe(
      5120,
    );
    expect(effectiveCadenceMinutes({ cadenceMinutes: 60, attempts: 1, state: 'error', capMinutes: 90 })).toBe(90);
  });

  it('never shortens the authored cadence: the cap bounds the multiplier, not the schedule', () => {
    // The default `backoffMaxMs` is 60 minutes, so a cap under the cadence is the
    // normal shape for the 3 h, 6 h, 12 h, daily and weekly presets. Capping the
    // result rather than the multiplier turned "back off" into "poll me hourly,
    // forever" for exactly those sources: one transient 5xx on a daily feed.
    const daily = (attempts: number, state: RelaxInput['state']): number =>
      effectiveCadenceMinutes({ cadenceMinutes: 1_440, attempts, state, capMinutes: 60 });
    expect(daily(1, 'error')).toBe(1_440);
    expect(daily(9, 'blocked')).toBe(1_440);
    expect(effectiveCadenceMinutes({ cadenceMinutes: 180, attempts: 1, state: 'blocked', capMinutes: 60 })).toBe(180);
    // …and a cap above the cadence still caps the multiplication.
    expect(effectiveCadenceMinutes({ cadenceMinutes: 180, attempts: 1, state: 'blocked', capMinutes: 1_000 })).toBe(
      720,
    );
  });
});

describe('inQuietHours', () => {
  it('is false with no window and with a zero-length window', () => {
    expect(inQuietHours(undefined, at(12))).toBe(false);
    expect(inQuietHours({ startHour: 6, endHour: 6 }, at(6))).toBe(false);
  });

  it('spans a daytime window, end exclusive', () => {
    expect(inQuietHours({ startHour: 6, endHour: 23 }, at(5))).toBe(false);
    expect(inQuietHours({ startHour: 6, endHour: 23 }, at(6))).toBe(true);
    expect(inQuietHours({ startHour: 6, endHour: 23 }, at(22))).toBe(true);
    expect(inQuietHours({ startHour: 6, endHour: 23 }, at(23))).toBe(false);
  });

  it('wraps a window that runs past midnight', () => {
    expect(inQuietHours({ startHour: 22, endHour: 6 }, at(22))).toBe(true);
    expect(inQuietHours({ startHour: 22, endHour: 6 }, at(3))).toBe(true);
    expect(inQuietHours({ startHour: 22, endHour: 6 }, at(6))).toBe(false);
    expect(inQuietHours({ startHour: 22, endHour: 6 }, at(12))).toBe(false);
  });
});
