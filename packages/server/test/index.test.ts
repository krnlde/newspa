/**
 * The barrel is the package's public surface: `packages/server/package.json`
 * exports `./src/index.ts`, so a module that is not re-exported here is not part
 * of `newspa-server`. The list is declared, and the barrel is checked against it
 * in both directions, so a rename is a build failure and a silent extra export is
 * a failing test.
 */
import { describe, expect, it } from 'vitest';
import { editionOf } from '../src/edition.ts';
import * as server from '../src/index.ts';
import { DEFAULT_STATE_EVENT_LIMIT, DEFAULT_STATE_ITEM_LIMIT, datelineFor, stateOf } from '../src/state.ts';

/** Every runtime value the barrel owes its consumers: the CLI, the tests, the next slice. */
const VALUE_EXPORTS: readonly string[] = [
  'editionOf',
  'stateOf',
  'datelineFor',
  'DEFAULT_STATE_ITEM_LIMIT',
  'DEFAULT_STATE_EVENT_LIMIT',
];

describe('the server barrel', () => {
  it('exposes every value it declares, so a rename is a build failure', () => {
    const surface: Record<string, unknown> = { ...server };
    for (const name of VALUE_EXPORTS) expect(surface[name], name).toBeDefined();
  });

  it('exports nothing the barrel did not declare', () => {
    const allowed = new Set(VALUE_EXPORTS);
    const extras = Object.keys({ ...server }).filter((name) => !allowed.has(name));
    expect(extras).toEqual([]);
  });

  it('is exactly the declared surface, in either direction', () => {
    expect(Object.keys({ ...server }).sort()).toEqual([...VALUE_EXPORTS].sort());
  });

  it('re-exports the modules themselves, not copies', () => {
    expect(server.editionOf).toBe(editionOf);
    expect(server.stateOf).toBe(stateOf);
    expect(server.datelineFor).toBe(datelineFor);
    expect(server.DEFAULT_STATE_ITEM_LIMIT).toBe(DEFAULT_STATE_ITEM_LIMIT);
    expect(server.DEFAULT_STATE_EVENT_LIMIT).toBe(DEFAULT_STATE_EVENT_LIMIT);
  });
});
