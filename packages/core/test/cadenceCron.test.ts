import { describe, expect, it } from 'vitest';
import { CRON_RANGES, describeCron, nextCronTime, parseCron } from '../src/cadenceCron.ts';

/** Local wall-clock dates: cron is local-time minute resolution, so the fixtures are too. */
const at = (year: number, month: number, day: number, hour: number, minute = 0, second = 0): Date =>
  new Date(year, month - 1, day, hour, minute, second, 0);

const next = (expression: string, from: Date, maxSearchDays?: number): Date =>
  nextCronTime(parseCron(expression), from, maxSearchDays);

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('parseCron', () => {
  it('declares the range of each field', () => {
    // Day-of-week goes to 7 because cron(5) accepts 7 as Sunday; `parseCron`
    // normalises it to 0, so a star still expands to exactly 0-6.
    expect(CRON_RANGES).toEqual([
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 7],
    ]);
  });

  it('expands a star into the whole field', () => {
    const fields = parseCron('* * * * *');
    expect(fields.minutes).toEqual(range(0, 59));
    expect(fields.hours).toEqual(range(0, 23));
    expect(fields.daysOfMonth).toEqual(range(1, 31));
    expect(fields.months).toEqual(range(1, 12));
    expect(fields.daysOfWeek).toEqual(range(0, 6));
    expect(fields.dayRestricted).toBe(false);
    expect(fields.weekdayRestricted).toBe(false);
  });

  it('expands a step over a star', () => {
    const fields = parseCron('*/5 * * * *');
    expect(fields.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(fields.dayRestricted).toBe(false);
  });

  it('expands ranges, lists and ranged steps, sorted and deduplicated', () => {
    expect(parseCron('0 9-17 * * *').hours).toEqual(range(9, 17));
    expect(parseCron('0,15,30,45 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('0-30/10 * * * *').minutes).toEqual([0, 10, 20, 30]);
    expect(parseCron('7-9/2 * * * *').minutes).toEqual([7, 9]);
    expect(parseCron('45,0,0,1-2 * * * *').minutes).toEqual([0, 1, 2, 45]);
  });

  it('flags both day fields, because Vixie cron ORs them', () => {
    const both = parseCron('0 0 13 * 5');
    expect(both.daysOfMonth).toEqual([13]);
    expect(both.daysOfWeek).toEqual([5]);
    expect(both.dayRestricted).toBe(true);
    expect(both.weekdayRestricted).toBe(true);
    const weekdayOnly = parseCron('5 4 * * 6,0');
    expect(weekdayOnly.daysOfWeek).toEqual([0, 6]);
    expect(weekdayOnly.dayRestricted).toBe(false);
    expect(weekdayOnly.weekdayRestricted).toBe(true);
    expect(parseCron('*/15 9-18 * * 1-5').dayRestricted).toBe(false);
  });

  it('keeps every field list it is given', () => {
    const fields = parseCron('0 0,12 1,15 1,7 1');
    expect(fields).toEqual({
      minutes: [0],
      hours: [0, 12],
      daysOfMonth: [1, 15],
      months: [1, 7],
      daysOfWeek: [1],
      dayRestricted: true,
      weekdayRestricted: true,
    });
  });

  it('rejects the wrong number of fields', () => {
    expect(() => parseCron('0 0 * *')).toThrow('cron "0 0 * *": expected 5 fields, got 4');
    expect(() => parseCron('0 0 * * * *')).toThrow('cron "0 0 * * * *": expected 5 fields, got 6');
    expect(() => parseCron('  ')).toThrow('cron "  ": expected 5 fields, got 1');
  });

  it('rejects values that are not numbers, not in range, or impossible to step', () => {
    const cases: readonly [string, string][] = [
      ['x 0 * * *', 'minute: "x" is not numeric'],
      ['-5 * * * *', 'minute: "-5" is not numeric'],
      ['30-10 * * * *', 'minute: range "30-10" runs backwards'],
      ['60 * * * *', 'minute: "60" outside 0-59'],
      ['5-70 * * * *', 'minute: "5-70" outside 0-59'],
      ['0/0 * * * *', 'minute: step "0" is not a positive integer'],
      ['*/x * * * *', 'minute: step "x" is not a positive integer'],
      ['1,,2 * * * *', 'minute: empty entry in "1,,2"'],
      ['* * 32 * *', 'day-of-month: "32" outside 1-31'],
      ['* * * 13 *', 'month: "13" outside 1-12'],
      ['* * * * 8', 'day-of-week: "8" outside 0-7'],
      ['Fri * * * *', 'minute: "Fri" is not numeric'],
    ];
    for (const [expression, message] of cases) {
      expect(() => parseCron(expression), expression).toThrow(message);
    }
  });
});

describe('nextCronTime', () => {
  it('takes the next matching minute, second stripped', () => {
    expect(next('*/5 * * * *', at(2026, 11, 9, 10, 30))).toEqual(at(2026, 11, 9, 10, 35));
    expect(next('* * * * *', at(2026, 11, 9, 10, 30, 45))).toEqual(at(2026, 11, 9, 10, 31));
    expect(next('*/5 * * * *', at(2026, 11, 9, 10, 57))).toEqual(at(2026, 11, 9, 11, 0));
    expect(next('5 4 * * 6,0', at(2026, 11, 9, 10, 0))).toEqual(at(2026, 11, 14, 4, 5));
  });

  // "Strictly after" is the documented contract, and the one that matters for
  // scheduling: truncating `from` to the minute put the answer *before* `from`,
  // so a cron source could poll twice in the same minute.
  it('is strictly after the moment it is given', () => {
    const from = at(2026, 11, 9, 10, 35);
    expect(next('*/5 * * * *', from).getTime()).toBeGreaterThan(from.getTime());
    expect(next('*/5 * * * *', at(2026, 11, 9, 10, 35, 30))).toEqual(at(2026, 11, 9, 10, 40));
    expect(next('35 10 * * *', at(2026, 11, 9, 10, 35, 0))).toEqual(at(2026, 11, 10, 10, 35));
  });

  it('rolls into the next day when the hour has passed', () => {
    expect(next('0 9 * * *', at(2026, 11, 9, 10, 30))).toEqual(at(2026, 11, 10, 9, 0));
    expect(next('30 10 * * *', at(2026, 11, 9, 10, 45))).toEqual(at(2026, 11, 10, 10, 30));
  });

  it('honours the weekday field, and ORs it with a restricted day-of-month', () => {
    expect(next('0 0 * * 1', at(2026, 11, 9, 12, 0))).toEqual(at(2026, 11, 16, 0, 0));
    expect(next('0 0 12 * 5', at(2026, 11, 9, 0, 30))).toEqual(at(2026, 11, 12, 0, 0));
    expect(next('0 0 13 * 5', at(2026, 11, 14, 0, 0))).toEqual(at(2026, 11, 20, 0, 0));
  });

  it('rolls month and year', () => {
    expect(next('0 0 * 2 *', at(2026, 11, 9, 0, 0))).toEqual(at(2027, 2, 1, 0, 0));
    expect(next('*/30 9 * 12 *', at(2026, 11, 9, 23, 10))).toEqual(at(2026, 12, 1, 9, 0));
    expect(next('0 0 1 1 *', at(2026, 11, 9, 12, 0))).toEqual(at(2027, 1, 1, 0, 0));
  });

  it('gives up, loudly, on an impossible day and month combination', () => {
    expect(() => next('0 0 30 2 *', at(2026, 11, 9, 0, 0))).toThrow(
      'cron: no occurrence within the search window (impossible day/month combination?)',
    );
    expect(() => next('0 0 30 2 *', at(2026, 11, 9, 0, 0), 10)).toThrow(/no occurrence within the search window/);
  });
});

describe('describeCron', () => {
  it('phrases the fields a source would actually set', () => {
    expect(describeCron('* * * * *')).toBe('every minute');
    expect(describeCron('5 9 * * 1-5')).toBe('09:05 on Mon,Tue,Wed,Thu,Fri');
    expect(describeCron('0 0 15 * *')).toBe('00:00 on day 15');
    expect(describeCron('15 6 1,15 * *')).toBe('06:15 on day 1,15');
    expect(describeCron('0 0 * * 3')).toBe('00:00 on Wed');
    expect(describeCron('30 8 * 6 6')).toBe('08:30 on Sat');
  });

  it('omits the day phrase when the field is unrestricted or full', () => {
    expect(describeCron('0 0 * * *')).toBe('00:00');
    expect(describeCron('0 0 * * 0-6')).toBe('00:00');
  });

  it('names the minute field in the every-hour phrase', () => {
    expect(describeCron('30 * * * *')).toBe('every hour at :30');
    expect(describeCron('*/15 * * * *')).toBe('every 15 minutes');
    expect(describeCron('* * * * *')).toBe('every minute');
    // A list has no short phrase; rendering `7,19:0,30` as a time would lie.
    expect(describeCron('0,30 7,19 * * *')).toBe('at cron 0,30 7,19 * * *');
  });

  it('accepts the month and weekday names cron(5) allows', () => {
    expect(describeCron('0 7 * * Mon-Fri')).toBe('07:00 on Mon,Tue,Wed,Thu,Fri');
    expect(next('0 0 1 jan *', at(2026, 11, 9, 0, 0))).toEqual(at(2027, 1, 1, 0, 0));
    expect(next('0 0 * * 7', at(2026, 11, 9, 0, 0))).toEqual(at(2026, 11, 15, 0, 0));
    expect(() => parseCron('0 0 * * xyz')).toThrow('day-of-week: "xyz" is not a recognised name');
  });

  it('propagates a parse failure', () => {
    expect(() => describeCron('0 0 * *')).toThrow(/expected 5 fields/);
  });
});
