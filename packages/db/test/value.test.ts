import { describe, expect, it } from 'vitest';
import {
  decodeBoolean,
  decodeCount,
  decodeCounts,
  decodeInteger,
  decodeJson,
  decodeJsonColumn,
  decodeOptionalInteger,
  decodeOptionalText,
  decodeReal,
  decodeText,
  encodeBoolean,
  encodeJson,
  encodeJsonColumn,
  JSON_COLUMNS,
  RowShapeError,
} from '../src/value.ts';

const ID = 'source "bbc"';

describe('decoders report the row, never a zero', () => {
  it('reads the values a column can hold', () => {
    expect(decodeText('title', ID, 'A headline')).toBe('A headline');
    expect(decodeOptionalText('summary', ID, null)).toBeNull();
    expect(decodeInteger('edit_count', ID, 3)).toBe(3);
    expect(decodeOptionalInteger('match_count', ID, null)).toBeNull();
    expect(decodeReal('score_realtime', ID, 12.5)).toBe(12.5);
    expect(decodeBoolean('enabled', ID, 1)).toBe(true);
    expect(decodeBoolean('enabled', ID, 0)).toBe(false);
  });

  it('names the column, the record and what it found', () => {
    expect(() => decodeText('title', ID, null)).toThrow(new RowShapeError('title', `for ${ID}`, 'SQL NULL'));
    expect(() => decodeInteger('edit_count', ID, undefined)).toThrow(/the column was not selected/);
    expect(() => decodeInteger('edit_count', ID, 'seven')).toThrow(/a string/);
    expect(() => decodeReal('score_realtime', ID, Number.NaN)).toThrow(/the number NaN/);
    // A REAL value in an INTEGER column is truncated, not refused: SQLite's
    // INTEGER affinity is what makes a bound JS number integral (measured), and
    // a hand-written 1.5 is read as the integer the column promises.
    expect(decodeOptionalInteger('match_count', ID, 1.5)).toBe(1);
    expect(() => decodeBoolean('enabled', ID, 2)).toThrow(/expected 0 or 1/);
    expect(() => decodeOptionalText('summary', ID, 5)).toThrow(/the number 5/);
  });

  it('truncates a float that an INTEGER column stored as a float', () => {
    // A bound JS number is REAL (measured); the column's INTEGER affinity keeps
    // integers integral, so this arm is a hand-written row, not a normal write.
    expect(decodeInteger('bytes', ID, 42.75)).toBe(42);
  });

  it('counts a missing row as 0 and a present row as an integer', () => {
    expect(decodeCount('c', undefined)).toBe(0);
    expect(decodeCount('c', { c: 7 })).toBe(7);
    expect(() => decodeCount('c', { other: 7 })).toThrow(/the column was not selected/);
  });

  it('reads per-source counts', () => {
    expect(
      decodeCounts('c', [
        { source_id: 'bbc', c: 3 },
        { source_id: 'guardian', c: 0 },
      ]),
    ).toEqual([
      { sourceId: 'bbc', count: 3 },
      { sourceId: 'guardian', count: 0 },
    ]);
    expect(() => decodeCounts('c', [{ c: 3 }])).toThrow(/source_id/);
    expect(() => decodeCounts('c', [{ source_id: 'bbc', c: null }])).toThrow(/SQL NULL/);
  });
});

describe('the JSON columns', () => {
  it('encodes only columns the schema declares', () => {
    expect(JSON_COLUMNS).toEqual([
      'source_json',
      'fields_json',
      'time_spec_json',
      'cache_json',
      'vary_json',
      'report_json',
    ]);
    expect(encodeJsonColumn('cache_json', { maxAgeSeconds: null })).toBe('{"maxAgeSeconds":null}');
    // The type rejects a name outside the list; the runtime gate is for a column
    // name that arrives as text, where the compiler has said nothing.
    const notAJsonColumn = 'body' as (typeof JSON_COLUMNS)[number];
    expect(() => encodeJsonColumn(notAJsonColumn, 1)).toThrow(/column "body" encode: not a JSON column of this schema/);
  });

  it('sorts keys, so a stored document is stable and an export diffs by field', () => {
    // `undefined` values are dropped, exactly as `JSON.stringify` drops them.
    expect(encodeJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } })).toBe(
      '{"a":{"c":[3,{"z":1}],"d":2},"b":1}',
    );
    expect(encodeJson(null)).toBe('null');
    expect(encodeJson('text')).toBe('"text"');
  });

  it('decodes a required document and refuses an absent one by name', () => {
    expect(decodeJsonColumn<{ a: number }>('cache_json', ID, '{"a":1}')).toEqual({ a: 1 });
    expect(() => decodeJsonColumn('cache_json', ID, null)).toThrow(/column "cache_json" for source "bbc": SQL NULL/);
    expect(() => decodeJsonColumn('cache_json', ID, undefined)).toThrow(/not selected/);
    expect(() => decodeJson('vary_json', ID, '{')).toThrow(/column "vary_json" for source "bbc": not JSON/);
  });

  it('treats SQL NULL as absent for an optional document', () => {
    expect(decodeOptionalInteger('x', ID, null)).toBeNull();
  });

  it('encodes a boolean as the 0/1 SQLite stores', () => {
    expect(encodeBoolean(true)).toBe(1);
    expect(encodeBoolean(false)).toBe(0);
  });
});
