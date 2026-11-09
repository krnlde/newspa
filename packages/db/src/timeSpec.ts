/**
 * The time part of a source spec — `cadenceCron` and `quietHours` — as one
 * JSON document.
 *
 * They are the only `SourceSpec` fields a query needs to *act* on (the
 * scheduler asks "is this inside a cron window / quiet hours?"), so they are
 * stored beside the scalars and parsed back through `core`'s own grammar: a
 * stored `cadenceCron` that `parseCron` rejects is a write-time bug, reported
 * with the source id at the read boundary. Absent is stored as `null` and read
 * back as `null`; the spec encoder turns that back into "field not present",
 * so `undefined` never reaches a record.
 */

import type { SourceSpec } from 'newspa-config';
import { parseCron, type QuietHours } from 'newspa-core';

export interface SourceTimeSpec {
  readonly cadenceCron: string | null;
  readonly quietHours: QuietHours | null;
}

export class TimeSpecError extends Error {
  constructor(sourceId: string, reason: string) {
    super(`source "${sourceId}" time_spec_json: ${reason}`);
    this.name = 'TimeSpecError';
  }
}

const quietHoursOf = (sourceId: string, value: unknown): QuietHours | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new TimeSpecError(sourceId, 'quietHours must be an object or null');
  const candidate = value as Record<string, unknown>;
  const start = candidate['startHour'];
  const end = candidate['endHour'];
  const isHour = (hour: unknown): hour is number =>
    typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  if (!isHour(start) || !isHour(end)) {
    throw new TimeSpecError(sourceId, 'quietHours must be {startHour, endHour} with integers in 0..23');
  }
  return { startHour: start, endHour: end };
};

const cronOf = (sourceId: string, value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TimeSpecError(sourceId, 'cadenceCron must be a string or null');
  try {
    // Measured: `parseCron` reports an unusable expression by **throwing**, it
    // does not return null, so the read boundary has to catch it.
    parseCron(value);
  } catch (cause) {
    throw new TimeSpecError(
      sourceId,
      `cadenceCron "${value}" does not parse (${cause instanceof Error ? cause.message : 'unknown'})`,
    );
  }
  return value;
};

export const timeSpecOf = (spec: SourceSpec): SourceTimeSpec => ({
  cadenceCron: spec.cadenceCron ?? null,
  quietHours: spec.quietHours ?? null,
});

/** What arrived, in words a human can act on. */
const shapeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;

/** Parse the stored document, rejecting what the scheduler could not act on. */
export const parseTimeSpec = (sourceId: string, text: string): SourceTimeSpec => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new TimeSpecError(sourceId, `not JSON (${cause instanceof Error ? cause.message : 'unreadable'})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TimeSpecError(sourceId, `expected an object, got ${shapeOf(parsed)}`);
  }
  const fields = parsed as Record<string, unknown>;
  return {
    cadenceCron: cronOf(sourceId, fields['cadenceCron']),
    quietHours: quietHoursOf(sourceId, fields['quietHours']),
  };
};
