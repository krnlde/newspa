import { describe, expect, it } from 'vitest';
import { parseServerEvent, serverEventSchema } from '../src/api.ts';

const events: readonly Record<string, unknown>[] = [
  { type: 'cycle:start', at: '2026-11-09T06:00:00Z' },
  { type: 'cycle:done', at: '2026-11-09T06:01:00Z', fetched: 8, newItems: 3, editedItems: 1 },
  { type: 'item:new', at: '2026-11-09T06:01:00Z', sourceId: 'bbc', title: 'T', link: 'https://x.test/a', score: 9.5 },
  {
    type: 'item:edited',
    at: '2026-11-09T06:01:00Z',
    sourceId: 'bbc',
    title: 'T',
    link: 'https://x.test/a',
    added: 4,
    removed: 2,
  },
  { type: 'source:health', at: '2026-11-09T06:01:00Z', source: 'bbc', state: 'blocked', note: null },
  { type: 'edition:updated', at: '2026-11-09T06:02:00Z', edition: '2026-11-09' },
];

describe('parseServerEvent', () => {
  it('parses every event type the server may push', () => {
    for (const event of events) {
      const parsed = parseServerEvent(JSON.stringify(event));
      expect(parsed.ok, JSON.stringify(event)).toBe(true);
      if (parsed.ok) expect(parsed.event).toEqual(event);
    }
  });

  it('names the six event types in the union', () => {
    expect(serverEventSchema.options.map((option) => option.shape.type.value)).toEqual([
      'cycle:start',
      'cycle:done',
      'item:new',
      'item:edited',
      'source:health',
      'edition:updated',
    ]);
  });

  it('reports invalid JSON as a typed failure', () => {
    const broken = parseServerEvent('{');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.message).toMatch(/JSON/);
    const empty = parseServerEvent('');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toBe('Unexpected end of JSON input');
  });

  it('reports a schema mismatch with the first issue', () => {
    const cases: readonly [string, string][] = [
      ['5', 'Invalid input: expected object, received number'],
      ['null', 'Invalid input: expected object, received null'],
      ['[]', 'Invalid input: expected object, received array'],
      ['{"type":"cycle:start"}', 'Invalid input: expected string, received undefined'],
      [
        '{"type":"party","at":"x"}',
        "Invalid discriminator value. Expected 'cycle:start' | 'cycle:done' | 'item:new' | 'item:edited' | 'source:health' | 'edition:updated'",
      ],
      [
        '{"type":"cycle:done","at":"x","fetched":-1,"newItems":0,"editedItems":0}',
        'Too small: expected number to be >=0',
      ],
    ];
    for (const [data, message] of cases) {
      const parsed = parseServerEvent(data);
      expect(parsed.ok, data).toBe(false);
      if (!parsed.ok) expect(parsed.message, data).toBe(message);
    }
  });
});
