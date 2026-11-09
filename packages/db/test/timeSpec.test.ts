import { describe, expect, it } from 'vitest';
import { parseTimeSpec, TimeSpecError, timeSpecOf } from '../src/timeSpec.ts';
import { HTML_SPEC, RSS_SPEC } from './support.ts';

const encoded = (cadenceCron: unknown, quietHours: unknown): string =>
  JSON.stringify({ cadenceCron, quietHours: quietHours ?? null });

describe('timeSpecOf', () => {
  it('reads the two fields a scheduler acts on out of a spec', () => {
    expect(timeSpecOf(RSS_SPEC)).toEqual({
      cadenceCron: '0 1-7 * * 6',
      quietHours: { startHour: 3, endHour: 4 },
    });
    // `cadenceCron`/`quietHours` are optional and the schema omits an absent
    // one, so the spec has no key at all and the stored document says `null`.
    expect('cadenceCron' in HTML_SPEC).toBe(false);
    expect(timeSpecOf(HTML_SPEC)).toEqual({ cadenceCron: null, quietHours: null });
  });
});

describe('parseTimeSpec', () => {
  it('refuses JSON that is not an object, and says what arrived', () => {
    expect(() => parseTimeSpec('rss-one', '[]')).toThrow(/expected an object, got an array/);
    expect(() => parseTimeSpec('rss-one', 'null')).toThrow(/expected an object, got null/);
    expect(() => parseTimeSpec('rss-one', '{')).toThrow(/not JSON/);
  });
  it('parses what core’s own cron grammar parses', () => {
    expect(parseTimeSpec('rss-one', encoded('0 1-7 * * 6', { startHour: 3, endHour: 4 }))).toEqual({
      cadenceCron: '0 1-7 * * 6',
      quietHours: { startHour: 3, endHour: 4 },
    });
    expect(parseTimeSpec('rss-one', encoded(null, null))).toEqual({ cadenceCron: null, quietHours: null });
  });

  it('treats a missing field as absent', () => {
    expect(parseTimeSpec('rss-one', '{}')).toEqual({ cadenceCron: null, quietHours: null });
  });

  it('reports the source id with the reason', () => {
    expect(() => parseTimeSpec('rss-one', '{')).toThrow(TimeSpecError);
    expect(() => parseTimeSpec('rss-one', '{')).toThrow(/source "rss-one" time_spec_json: not JSON/);
    expect(() => parseTimeSpec('rss-one', '[]')).toThrow(/expected an object, got an array/);
    expect(() => parseTimeSpec('rss-one', '"a"')).toThrow(/expected an object, got string/);
  });

  it('refuses a cron core cannot parse, and a shape the scheduler cannot act on', () => {
    expect(() => parseTimeSpec('rss-one', encoded('every monday', null))).toThrow(
      /cadenceCron "every monday" does not parse/,
    );
    expect(() => parseTimeSpec('rss-one', encoded(7, null))).toThrow(/cadenceCron must be a string or null/);
    expect(() => parseTimeSpec('rss-one', encoded(null, 'night'))).toThrow(/quietHours must be an object or null/);
    expect(() => parseTimeSpec('rss-one', encoded(null, { startHour: 3 }))).toThrow(
      /quietHours must be \{startHour, endHour\}/,
    );
    expect(() => parseTimeSpec('rss-one', encoded(null, { startHour: 3, endHour: 24 }))).toThrow(/integers in 0\.\.23/);
    expect(() => parseTimeSpec('rss-one', encoded(null, { startHour: 2.5, endHour: 4 }))).toThrow(
      /integers in 0\.\.23/,
    );
  });
});
