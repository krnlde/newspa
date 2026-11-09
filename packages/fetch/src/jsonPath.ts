/**
 * Path resolution for a JSON source. `itemsPath` and the field paths are
 * authored by a human (D-008: "`kind: 'json'` takes `itemsPath` + relative
 * field paths"), so the two things that matter are the grammar a picker can
 * write and an honest answer when the path is not there: **the keys that
 * were**. A publisher's redesign renames the container, and "no such path"
 * without the key list is a stack trace; with it, the fix is visible from the
 * health note.
 *
 * Grammar: dot-separated keys, `[n]` for an index, `[]` to walk an array.
 * `props.pageProps.topStories[]` and `data.children[].data.title` are the two
 * shapes real endpoints use (measured on Algolia's `hits[]` and Reddit's
 * `data.children[].data`).
 */

export interface PathStep {
  readonly key: string;
  readonly index: number | null;
  /** `[]` — continue under every element of an array. */
  readonly each: boolean;
}

const SEGMENT = /([^.[\]]+)|\[(\d*)\]/g;

export const parsePath = (path: string): PathStep[] => {
  const steps: PathStep[] = [];
  for (const match of path.matchAll(SEGMENT)) {
    const key = match[1];
    const bracket = match[2];
    if (key !== undefined) {
      steps.push({ key, index: null, each: false });
      continue;
    }
    // `[]` walks an array; `[3]` picks one element.
    steps.push({
      key: '',
      index: bracket === undefined || bracket.length === 0 ? null : Number(bracket),
      each: bracket === '',
    });
  }
  return steps;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const indexStep = (current: readonly unknown[], index: number): readonly unknown[] => {
  const next: unknown[] = [];
  for (const value of current) {
    if (!Array.isArray(value)) continue;
    const found = value[index];
    if (found !== undefined) next.push(found);
  }
  return next;
};

/** `[]` — continue under every element of every array at this point. */
const eachStep = (current: readonly unknown[]): readonly unknown[] => {
  const next: unknown[] = [];
  for (const value of current) if (Array.isArray(value)) next.push(...value);
  return next;
};

const keyStep = (current: readonly unknown[], key: string): readonly unknown[] => {
  const next: unknown[] = [];
  for (const value of current) {
    if (isRecord(value)) {
      const found = value[key];
      if (found !== undefined) next.push(found);
      continue;
    }
    // A wrapper array is the shape of `data.children`-style payloads: the key
    // is meant for every element, not for the array itself.
    if (!Array.isArray(value)) continue;
    for (const element of value) {
      if (isRecord(element) && element[key] !== undefined) next.push(element[key]);
    }
  }
  return next;
};

const take = (current: readonly unknown[], step: PathStep): readonly unknown[] => {
  if (step.index !== null) return indexStep(current, step.index);
  if (step.each) return eachStep(current);
  return keyStep(current, step.key);
};

export interface Resolved {
  readonly values: readonly unknown[];
  /** The keys of the deepest record the path reached, for a failure detail. */
  readonly reached: readonly string[];
}

/** Resolve a path. `reached` is what a redesign looks like from the inside. */
export const resolvePath = (root: unknown, path: string): Resolved => {
  const steps = parsePath(path);
  let current: readonly unknown[] = [root];
  const reached: string[] = [];
  for (const step of steps) {
    const first = current[0];
    const probe = Array.isArray(first) ? first[0] : first;
    if (isRecord(probe)) {
      reached.length = 0;
      reached.push(...Object.keys(probe));
    }
    current = take(current, step);
    if (current.length === 0) break;
  }
  return { values: current, reached };
};

/** The keys of the deepest record a path reached. */
export const keysAt = (root: unknown, path: string): readonly string[] => resolvePath(root, path).reached;

const URL_KEYS = ['url', 'src', 'secure_url', 'href', 'link', 'value', 'full', 'big'];
const TEXT_KEYS = ['text', 'label', 'name', 'title', 'content'];

const scalarRecord = (value: Record<string, unknown>): string | null => {
  for (const key of [...URL_KEYS, ...TEXT_KEYS]) {
    const found = value[key];
    if (typeof found === 'string' && found.length > 0) return found;
  }
  return null;
};

const scalarArray = (value: readonly unknown[]): string | null => {
  const parts: string[] = [];
  for (const element of value) {
    const text = scalar(element);
    if (text !== null && text.length > 0) parts.push(text);
  }
  return parts.length > 0 ? parts.join(', ') : null;
};

/**
 * A scalar out of a JSON value. Endpoints wrap the same field in an object
 * (`previewImageUrl: { url: "…" }` on a newsroom API, `image: { srcset: … }` on
 * a search index), so an object is searched for the usual keys before the
 * answer is "no". An array joins with `, `: `tags[].label` is a list of words.
 */
export const scalar = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return scalarArray(value);
  if (isRecord(value)) return scalarRecord(value);
  return null;
};

export interface ItemsOutcome {
  readonly ok: true;
  readonly items: readonly Record<string, unknown>[];
}

export interface ItemsFault {
  readonly ok: false;
  readonly detail: string;
}

const describe = (value: unknown): string => (Array.isArray(value) ? 'an array' : typeof value);

const collectRecords = (values: readonly unknown[]): readonly Record<string, unknown>[] => {
  const items: Record<string, unknown>[] = [];
  for (const value of values) {
    if (Array.isArray(value)) items.push(...value.filter(isRecord));
    else if (isRecord(value)) items.push(value);
  }
  return items;
};

/** The item array. A path that resolves to nothing is an error, never `[]`. */
export const itemsAt = (root: unknown, itemsPath: string): ItemsOutcome | ItemsFault => {
  const resolved = resolvePath(root, itemsPath);
  if (resolved.values.length === 0) {
    const keys =
      resolved.reached.length > 0
        ? `; the keys there are: ${resolved.reached.slice(0, 10).join(', ')}`
        : '; there is no object at that depth';
    return { ok: false, detail: `'${itemsPath}' resolved to nothing${keys}` };
  }
  const items = collectRecords(resolved.values);
  if (items.length > 0) return { ok: true, items };
  const first = resolved.values[0];
  return { ok: false, detail: `'${itemsPath}' resolved to ${describe(first)}, not an array of objects` };
};
