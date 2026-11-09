import { describe, expect, it } from 'vitest';
import { formatHttpDate, parseHttpDate } from '../src/httpDate.ts';

describe('parseHttpDate', () => {
  it('reads the three HTTP-date grammars', () => {
    expect(parseHttpDate('Sun, 09 Nov 2025 10:00:00 GMT')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('Sun, 09-Nov-25 10:00:00 GMT')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('Sun Nov  9 10:00:00 2025')).toBe('2025-11-09T10:00:00.000Z');
  });

  it('reads asctime and zone-less ISO as UTC, not as the machine’s local time', () => {
    // Measured: `Date.parse('Sun Nov  9 10:00:00 2025')` and
    // `Date.parse('2025-11-09 10:00:00')` return the machine's zone, so a
    // story's age would depend on the reader's clock. The strict parse cannot.
    expect(parseHttpDate('Sun Nov  9 10:00:00 2025')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('2025-11-09 10:00:00')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('2025-11-09T10:00:00')).toBe('2025-11-09T10:00:00.000Z');
  });

  it('reads ISO, with an offset honoured and a bare date as midnight', () => {
    expect(parseHttpDate('2025-11-09T10:00:00Z')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('2025-11-09T10:00:00+02:00')).toBe('2025-11-09T08:00:00.000Z');
    expect(parseHttpDate('2025-11-09T10:00:00-0500')).toBe('2025-11-09T15:00:00.000Z');
    // Second resolution: the fractional part is dropped, because every HTTP
    // date grammar is whole seconds and `If-Modified-Since` has no sub-second.
    expect(parseHttpDate('2025-11-09T10:00:00.500Z')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('2025-11-09')).toBe('2025-11-09T00:00:00.000Z');
  });

  it('reads RFC 850 two-digit years the POSIX way', () => {
    expect(parseHttpDate('Sun, 09-Nov-25 10:00:00 GMT')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('Sun, 09-Nov-69 10:00:00 GMT')).toBe('2069-11-09T10:00:00.000Z');
    expect(parseHttpDate('Sun, 09-Nov-70 10:00:00 GMT')).toBe('1970-11-09T10:00:00.000Z');
  });

  it('accepts the zone spellings servers send, and a lying weekday', () => {
    for (const zone of ['GMT', 'UTC', 'UT', 'Z', '+0000', '-0000']) {
      expect(parseHttpDate(`Mon, 09 Nov 2025 10:00:00 ${zone}`)).toBe('2025-11-09T10:00:00.000Z');
    }
    // 9 Nov 2025 is a Sunday. The weekday is decoration; the instant is the value.
    expect(parseHttpDate('Mon, 09 Nov 2025 10:00:00 GMT')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('sun, 09 nov 2025 10:00:00 gmt')).toBe('2025-11-09T10:00:00.000Z');
    expect(parseHttpDate('  Sun, 09 Nov 2025 10:00:00 GMT  ')).toBe('2025-11-09T10:00:00.000Z');
  });

  it('returns null for anything it would have to guess about', () => {
    for (const value of [
      'not a date',
      '',
      '   ',
      null,
      undefined,
      '09/11/2025 10:00:00',
      '11/09/2025',
      '12345',
      'Sun, 09 Nov 2025 10:00:00 EST',
      'Sun, 09 Dec 2025 24:00:00 GMT',
      'Sun, 09 Nov 2025 10:61:00 GMT',
      'Sun, 09 Nov 2025 10:00:00 GMT; x=1',
      '2025-13-01T00:00:00Z',
      '2025-02-31',
      '2025-11-32',
      '2025-11-09T10:00:00+24:00',
      '2025-11-09T10:00:00+00:61',
    ]) {
      expect(parseHttpDate(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('formatHttpDate', () => {
  it('writes the wire format, to the second', () => {
    expect(formatHttpDate('2025-11-09T10:00:00.500Z')).toBe('Sun, 09 Nov 2025 10:00:00 GMT');
    expect(formatHttpDate('2026-01-01T00:00:00+02:00')).toBe('Wed, 31 Dec 2025 22:00:00 GMT');
  });

  it('round-trips through parseHttpDate', () => {
    const iso = '2025-06-30T23:59:59.000Z';
    expect(parseHttpDate(formatHttpDate(iso))).toBe(iso);
  });

  it('is null for a value it cannot place on the calendar', () => {
    expect(formatHttpDate('yesterday')).toBeNull();
  });
});
