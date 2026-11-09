/**
 * The timestamp grammars the web actually sends, in and out.
 *
 * This is a parsing module, not a "time" module: the paper's own day clock is in
 * `time.ts`, and this file is only about reading a string a server wrote.
 *
 * Measured (docs/decisions.md D-020): `Date.parse` reads `Sun Nov  9 10:00:00 2025`
 * and `2025-11-09 10:00:00` in the **machine's** zone, and happily accepts
 * `09/11/2025` as US month/day. So the parse here is written by hand: a story's
 * age must not depend on which machine opens the paper, and an ambiguous date
 * is worth less than no date.
 */

const MONTHS: readonly string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (value: number): string => String(value).padStart(2, '0');

const inBounds = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

/**
 * RFC 850's two-digit year, read the POSIX way: `69` → 2069, `70` → 1970.
 * Treating `70` as 2070 would invent a future timestamp, and a future
 * `Last-Modified` is a validator we then have to explain away.
 */
const expandYear = (raw: string): number => {
  const n = Number(raw);
  return raw.length === 2 ? (n < 70 ? 2000 + n : 1900 + n) : n;
};

const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

const offsetMinutes = (token: string): number => {
  const upper = token.trim().toUpperCase();
  // Empty = no zone in the string, and that is UTC here (see `parseHttpDate`).
  if (upper.length === 0 || upper === 'GMT' || upper === 'UTC' || upper === 'UT' || upper === 'Z') return 0;
  if (upper === '+0000' || upper === '-0000') return 0;
  const match = OFFSET.exec(upper);
  if (match === null) return Number.NaN;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!inBounds(hours, 0, 23) || !inBounds(minutes, 0, 59)) return Number.NaN;
  return sign * (hours * 60 + minutes);
};

/** `Wdy, DD Mon YYYY HH:MM:SS GMT` (RFC 1123) and `Wdy, DD-Mon-YY …` (RFC 850). */
const RFC_DATE =
  /^(?:([A-Za-z]{3}),\s*)?(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+([A-Za-z0-9+-]+))?$/;

/** `Sun Nov  9 10:00:00 2025` (asctime). No zone, and by definition it is GMT. */
const ASCTIME = /^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

/** ISO 8601, date and optional time. **No offset means UTC**, see `parseHttpDate`. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

/** `noUncheckedIndexedAccess` is on, so every capture group is read through this. */
const g = (match: RegExpExecArray, index: number): string => match[index] ?? '';

const isoFrom = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  offsetMin: number,
): string | null => {
  if (!inBounds(month, 1, 12) || !inBounds(day, 1, 31) || !inBounds(hour, 0, 23) || !inBounds(minute, 0, 59))
    return null;
  if (!inBounds(second, 0, 60) || Number.isNaN(offsetMin)) return null;
  // Calendar round-trip **before** the offset: `Date.UTC` normalises `31 Feb`
  // into March, so a server's impossible date would otherwise come back as a
  // real, later instant. A genuine timestamp with an offset must survive the
  // check, so the wall-clock fields are compared, not the shifted instant.
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(naive)) return null;
  const check = new Date(naive);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const ms = naive - offsetMin * 60_000;
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
};

/**
 * Parse a publisher's or CDN's timestamp into UTC ISO. `null` means "no usable
 * date", which is always the safe answer: no validator, no fast path, full parse.
 *
 * **A zone-less timestamp is read as UTC, never as local time** — the whole
 * reason this function exists. Deliberately rejected: bare `DD/MM/YYYY` and
 * `MM/DD/YYYY` (ambiguous), and any offset outside `±0000` (no HTTP-date
 * grammar has one, so a server sending `EST` is a bug we decline to guess about).
 * The weekday is ignored: `Mon, 09 Nov 2025` is Sunday's date, and the instant
 * is the value a publisher intends.
 */
export const parseHttpDate = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  if (text === undefined || text.length === 0) return null;

  const rfc = RFC_DATE.exec(text);
  if (rfc !== null) {
    return isoFrom(
      expandYear(g(rfc, 4)),
      MONTHS.indexOf(g(rfc, 3).toLowerCase()) + 1,
      Number(g(rfc, 2)),
      Number(g(rfc, 5)),
      Number(g(rfc, 6)),
      Number(g(rfc, 7)),
      offsetMinutes(g(rfc, 8)),
    );
  }
  const asc = ASCTIME.exec(text);
  if (asc !== null) {
    // Groups: 1 weekday, 2 month, 3 day, 4 hour, 5 minute, 6 second, 7 year.
    return isoFrom(
      Number(g(asc, 7)),
      MONTHS.indexOf(g(asc, 2).toLowerCase()) + 1,
      Number(g(asc, 3)),
      Number(g(asc, 4)),
      Number(g(asc, 5)),
      Number(g(asc, 6)),
      0,
    );
  }
  const iso = ISO_DATE.exec(text);
  if (iso !== null) {
    return isoFrom(
      Number(g(iso, 1)),
      Number(g(iso, 2)),
      Number(g(iso, 3)),
      Number(g(iso, 4) || '0'),
      Number(g(iso, 5) || '0'),
      Number(g(iso, 6) || '0'),
      offsetMinutes(g(iso, 7)),
    );
  }
  return null;
};

/**
 * The wire format for `If-Modified-Since`: GMT, whole seconds, capitalized
 * month. A header a server cannot parse is a broken validator, and every
 * HTTP-date grammar spells the month `Nov`.
 */
export const formatHttpDate = (iso: string): string | null => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const d = new Date(at - (at % 1000));
  const month = (MONTHS[d.getUTCMonth()] ?? '').replace(/^([a-z])/, (_, first: string) => first.toUpperCase());
  return `${DAY_NAMES[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${month} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT`;
};
