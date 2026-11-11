/**
 * The `SourceSpec` round trip through a `sources` row.
 *
 * A spec lives in **three** columns, and the row is only a spec when all three
 * are read together (D-011: `sources/*.json` is the truth, the row is a
 * runnable copy of it):
 *  - `source_json` — the spec minus `cadenceCron` and `quietHours`;
 *  - `time_spec_json` — those two fields, beside it, because the scheduler
 *    reads them on every tick and a JSON parse per source per tick is the cost
 *    the schema exists to avoid;
 *  - `enabled` — the one spec field the app changes on its own (D-011: the
 *    paper has no UI, and `setEnabled` is the seam a future one uses), so the
 *    column, not the JSON copied from `sources/*.json`, is the answer.
 *
 * Two repositories read it — `sources.ts` for the paper,
 * `sourcesScheduling.ts` for the scheduler — and a rule spread over three
 * columns is a rule that drifts, so the decode and the strip live here, once.
 */
import type { SourceSpec } from 'newspa-config';
import { parseTimeSpec } from './timeSpec.ts';
import { decodeBoolean, decodeJsonColumn, decodeText, type Row } from './value.ts';

/** `cadenceCron`/`quietHours` live in their own column, so they leave the spec JSON. */
export const specWithoutTime = (spec: SourceSpec): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...spec };
  delete out['cadenceCron'];
  delete out['quietHours'];
  return out;
};

/** The spec a row holds: the JSON, the two time fields put back, the column's `enabled`. */
export const specOf = (sourceId: string, row: Row): SourceSpec => {
  const stored = decodeJsonColumn<Record<string, unknown>>('source_json', sourceId, row['source_json']);
  const timeSpec = parseTimeSpec(sourceId, decodeText('time_spec_json', sourceId, row['time_spec_json']));
  if (timeSpec.cadenceCron !== null) stored['cadenceCron'] = timeSpec.cadenceCron;
  if (timeSpec.quietHours !== null) stored['quietHours'] = timeSpec.quietHours;
  stored['enabled'] = decodeBoolean('enabled', `source ${sourceId}`, row['enabled']);
  return stored as SourceSpec;
};
