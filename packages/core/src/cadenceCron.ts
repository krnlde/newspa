/**
 * Optional 5-field cron for power users. Hidden from the UI on purpose
 * (docs/decisions.md): cadence lives in `cadenceMinutes`, because cron is
 * calendar scheduling and this job is rate scheduling with state.
 *
 * Semantics we implement, stated so nobody has to guess:
 *   `cadenceCron` is the EARLIEST ALLOWED TIME, not an exact one. The scheduler
 *   adds jitter and failure backoff on top, so a cron-anchored source cannot
 *   re-hammer a site that answered 429.
 *
 * Fields: `minute hour day-of-month month day-of-week`. Supports `*`, a step
 * (star, slash, n), a range `a-b`, a ranged step (`a-b` slash n), a list
 * `a,b,c`, bare numbers, and the three-letter month/day names cron(5) allows
 * (`Mon-Fri`, `jan-dec`, `7` as Sunday). When both day fields are restricted,
 * day matches if EITHER matches (Vixie cron), which is documented because it is
 * the classic surprise.
 */

export interface CronFields {
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  readonly daysOfWeek: readonly number[];
  readonly dayRestricted: boolean;
  readonly weekdayRestricted: boolean;
}

export const CRON_RANGES: readonly [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

const FIELD_NAMES: readonly string[] = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];

const MONTH_NAMES: readonly string[] = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const DAY_NAMES: readonly string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Vixie cron accepts three-letter names in the last two fields, and `describeCron`
 * renders them, so they must be accepted — a format the same module prints and
 * refuses to parse is a bug waiting for a user.
 */
const namesToNumbers = (token: string, field: string): string => {
  const names = field === 'month' ? MONTH_NAMES : field === 'day-of-week' ? DAY_NAMES : null;
  if (names === null) return token;
  return token.replace(/[a-z]+/gi, (word) => {
    const index = names.indexOf(word.toLowerCase());
    if (index === -1) throw new Error(`${field}: "${word}" is not a recognised name`);
    // Months are 1-based, days 0-based (sun = 0).
    return String(field === 'month' ? index + 1 : index);
  });
};

const expand = (token: string, min: number, max: number, field: string): number[] => {
  const values = new Set<number>();
  for (const part of token.split(',')) {
    if (part.length === 0) throw new Error(`${field}: empty entry in "${token}"`);
    const [body, stepText] = part.split('/');
    if (body === undefined) throw new Error(`${field}: missing value in "${part}"`);
    const step = stepText === undefined ? 1 : Number.parseInt(stepText, 10);
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`${field}: step "${stepText ?? ''}" is not a positive integer`);

    let start = min;
    let end = max;
    if (body !== '*') {
      const bounds = body.split('-');
      start = Number.parseInt(bounds[0] ?? '', 10);
      end = bounds.length > 1 ? Number.parseInt(bounds[1] ?? '', 10) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`${field}: "${body}" is not numeric`);
      }
      if (bounds.length > 1 && end < start) throw new Error(`${field}: range "${body}" runs backwards`);
    }
    if (start < min || end > max) throw new Error(`${field}: "${body}" outside ${min}-${max}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
};

const isRestricted = (token: string): boolean => token !== '*' && !token.startsWith('*/');

export const parseCron = (expression: string): CronFields => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron "${expression}": expected 5 fields, got ${parts.length}`);
  }
  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = parts;
  const tokens: readonly string[] = [minute, hour, dayOfMonth, month, dayOfWeek];
  const parsed: number[][] = tokens.map((token, index) => {
    const range: [number, number] = CRON_RANGES[index] ?? [0, 0];
    const field = FIELD_NAMES[index] ?? `field ${index}`;
    const values = expand(namesToNumbers(token, field), range[0], range[1], field);
    // cron(5) allows 7 as Sunday; normalising it here keeps `includes()` exact.
    return index === 4 ? [...new Set(values.map((value) => (value === 7 ? 0 : value)))].sort((a, b) => a - b) : values;
  });

  const [minutes = [], hours = [], daysOfMonth = [], months = [], daysOfWeek = []] = parsed;
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    dayRestricted: isRestricted(dayOfMonth),
    weekdayRestricted: isRestricted(dayOfWeek),
  };
};

const includes = (values: readonly number[], value: number): boolean => values.includes(value);

const nextFrom = (at: Date, field: 'minute' | 'hour' | 'day', values: readonly number[]): Date => {
  const next = new Date(at.getTime());
  if (field === 'minute') {
    for (let minute = next.getMinutes() + 1; minute <= 59; minute += 1) {
      if (includes(values, minute)) {
        next.setMinutes(minute, 0, 0);
        return next;
      }
    }
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }
  if (field === 'hour') {
    for (let hour = next.getHours() + 1; hour <= 23; hour += 1) {
      if (includes(values, hour)) {
        next.setHours(hour, 0, 0, 0);
        return next;
      }
    }
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    return next;
  }
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
};

/**
 * Next occurrence strictly after `from`, minute resolution, local time.
 * Bounded by 400 days of search so a `31 2 30 2 *`-style expression fails
 * loudly instead of spinning.
 */
export const nextCronTime = (fields: CronFields, from: Date, maxSearchDays = 400): Date => {
  const limit = from.getTime() + maxSearchDays * 86_400_000;
  let cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  // Truncating to the minute can put the cursor *before* `from` (10:35:30 →
  // 10:35:00), and a matching minute would then return a time in the past: a
  // cron-anchored source would fire twice in the same minute. Strictly after.
  if (cursor.getTime() <= from.getTime()) cursor.setMinutes(cursor.getMinutes() + 1);

  for (let guard = 0; guard < 500_000; guard += 1) {
    if (cursor.getTime() > limit) {
      throw new Error('cron: no occurrence within the search window (impossible day/month combination?)');
    }
    if (!includes(fields.months, cursor.getMonth() + 1)) {
      cursor = nextFrom(cursor, 'day', []);
      continue;
    }
    const dayOk =
      !fields.dayRestricted && !fields.weekdayRestricted
        ? true
        : fields.dayRestricted && fields.weekdayRestricted
          ? includes(fields.daysOfMonth, cursor.getDate()) || includes(fields.daysOfWeek, cursor.getDay())
          : fields.dayRestricted
            ? includes(fields.daysOfMonth, cursor.getDate())
            : includes(fields.daysOfWeek, cursor.getDay());
    if (!dayOk) {
      cursor = nextFrom(cursor, 'day', []);
      continue;
    }
    if (!includes(fields.hours, cursor.getHours())) {
      cursor = nextFrom(cursor, 'hour', fields.hours);
      continue;
    }
    if (!includes(fields.minutes, cursor.getMinutes())) {
      cursor = nextFrom(cursor, 'minute', fields.minutes);
      continue;
    }
    return cursor;
  }
  throw new Error('cron: search guard tripped');
};

/** Shortest human phrase for a cron expression, for logs and health notes. */
export const describeCron = (expression: string): string => {
  const fields = parseCron(expression);
  const [minute = '', hour = ''] = expression.trim().split(/\s+/);
  const isTime = /^\d+$/.test(minute) && /^\d+$/.test(hour);
  const time =
    minute === '*' && hour === '*'
      ? 'every minute'
      : // The `:mm` is the MINUTE field. Reading `hour` here printed "every hour
        // at :0*" for `30 * * * *` and the same phrase for `*/15 * * * *`.
        /^\*\/\d+$/.test(minute) && hour === '*'
        ? `every ${minute.slice(2)} minutes`
        : hour === '*' && /^\d+$/.test(minute)
          ? `every hour at :${minute.padStart(2, '0')}`
          : isTime
            ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
            : // A list or range in hour/minute has no short phrase; say so rather
              // than rendering `7,19:0,30` as if it were a time.
              `at cron ${expression.trim()}`;
  const weekdayNames: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayPart =
    fields.weekdayRestricted && fields.daysOfWeek.length < 7
      ? ` on ${fields.daysOfWeek.map((d) => weekdayNames[d] ?? `day ${d}`).join(',')}`
      : fields.dayRestricted && fields.daysOfMonth.length < 31
        ? ` on day ${fields.daysOfMonth.join(',')}`
        : '';
  return `${time}${dayPart}`;
};
