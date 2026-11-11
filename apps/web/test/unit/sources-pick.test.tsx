import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n/index.ts';
import { en } from '../../src/i18n/locales/en.ts';
import {
  boxOf,
  callsOf,
  hanging,
  PAGE_TEXT,
  PICK,
  PICKED_TEXT,
  pickButton,
  ROW,
  refusalOf,
  report,
  stubHangingPick,
  stubPickStart,
  stubPickWire,
  tick,
} from './support/pickWire.tsx';
import { one, type SourcesFetchMock, STATUS, sourcesHarness, textOf } from './support/sourcesWire.tsx';

/**
 * The pick **job** (WP6, D-036): `SourcesSection.tsx` owns it, and the job is a
 * window on the machine that runs the server, not a request.
 *
 * `POST /api/pick` answers at once — a request that waits for a cursor dies in a
 * proxy — so the shell asks `GET /api/pick` every 1.5 s while the report says
 * `running`, and stops at `picked`, at `failed`, on an errored request, and when the
 * modal unmounts (D-035 unmounts the overlay, and a poll that outlives it is a timer
 * spinning at a page that has gone away).
 *
 * **A landed pick fills the box and posts no save** (D-036): the assertion that
 * matters is that no `POST /api/sources` follows the report, because the reader
 * presses SAVE through the one validated write path. A `failed` report's `sentence`
 * and `messages` print in the panel's status region, in the server's own words about
 * its own browser (rule 5, D-019).
 *
 * Fake timers start **after** the list has loaded: `findByText` needs the real clock.
 */

const { mount, dispose } = sourcesHarness();

/** The list is on the page; the box is open; PICK is pressed. The clock is faked. */
const pressed = async (): Promise<HTMLElement> => {
  const { root } = mount();
  await screen.findByText('Example Page');
  vi.useFakeTimers();
  fireEvent.click(one("[data-part='source-edit']"));
  fireEvent.click(pickButton());
  await tick(0);
  return root;
};

/** The list is on the page, the box is open, PICK is pressed, and `respond` is the start. */
const pressedStart = async (
  respond: () => Response,
): Promise<{ readonly root: HTMLElement; readonly mock: SourcesFetchMock }> => {
  const mock = stubPickStart(respond);
  const { root } = mount();
  await screen.findByText('Example Page');
  vi.useFakeTimers();
  fireEvent.click(one("[data-part='source-edit']"));
  fireEvent.click(pickButton());
  await tick(0);
  return { root, mock };
};

const refused = (): Response => refusalOf(["a pick window is open for 'tech'"], 409);

describe('the pick job (SourcesSection)', () => {
  beforeEach(async () => {
    await initI18n({ language: 'en' });
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });

  it('opens the window, says it is picking, and asks for the report on the poll', async () => {
    const mock = stubPickWire([report()]);
    const root = await pressed();
    expect(callsOf(mock, 'POST', '/api/pick')).toBe(1);
    expect(pickButton().textContent).toBe(en.sources.picking);
    expect(pickButton().disabled).toBe(true);
    await tick(1_500);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(1);
    expect(root.querySelectorAll(PICK)).toHaveLength(1);
  });

  it('fills the box when the pick lands, writes nothing, and stops asking', async () => {
    const mock = stubPickWire([
      report(),
      report({
        state: 'picked',
        sentence: 'picked 12 items',
        messages: ['the list matched 12 elements'],
        text: PICKED_TEXT,
      }),
    ]);
    await pressed();
    await tick(1_500);
    expect(boxOf().value).toBe(PAGE_TEXT);
    await tick(1_500);
    expect(boxOf().value).toBe(PICKED_TEXT);
    expect(textOf(STATUS)).toBe('the list matched 12 elements');
    expect(pickButton().textContent).toBe(en.sources.pick);
    expect(callsOf(mock, 'POST', '/api/sources')).toBe(0);
    await tick(6_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(2);
  });

  it('stops asking, and states the sentence in the status region, when the pick failed', async () => {
    const mock = stubPickWire([
      report(),
      report({
        state: 'failed',
        sentence: "pick for 'page' failed: the path did not map into the fetch",
        messages: ['the DOM you clicked is not the DOM the poller fetches'],
      }),
    ]);
    await pressed();
    await tick(1_500);
    await tick(1_500);
    expect(textOf(STATUS)).toContain('the path did not map into the fetch');
    expect(textOf(STATUS)).toContain('not the DOM the poller fetches');
    expect(boxOf().value).toBe(PAGE_TEXT);
    await tick(6_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(2);
  });

  it('stops asking and states the line when a report request errors: a 404 is an answer', async () => {
    const mock = stubPickWire([
      refusalOf(['no pick has run for page in this process: start one with POST /api/pick'], 404),
    ]);
    await pressed();
    await tick(1_500);
    expect(textOf(STATUS)).toContain('no pick has run for page in this process');
    await tick(6_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(1);
  });

  it('stops asking when the modal unmounts: no timer is left spinning at a page that is gone', async () => {
    const mock = stubPickWire([report(), report(), report(), report()]);
    await pressed();
    await tick(1_500);
    const asked = callsOf(mock, 'GET', '/api/pick');
    expect(asked).toBe(1);
    cleanup();
    await tick(9_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(asked);
  });

  it('does nothing when a report lands after the modal has closed: no fill, no next ask', async () => {
    const late = hanging();
    const mock = stubHangingPick(() => late.promise);
    await pressed();
    await tick(1_500);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(1);
    cleanup();
    await tick(0);
    late.open();
    await tick(9_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(1);
    expect(document.querySelector(PICK)).toBeNull();
  });

  it('states nothing when a report request dies after the modal has closed', async () => {
    const late = hanging();
    const mock = stubHangingPick(() => late.promise);
    await pressed();
    await tick(1_500);
    cleanup();
    await tick(0);
    late.fail();
    await tick(9_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(1);
  });

  it('states a pick whose request died, in the words the transport threw (rule 5)', async () => {
    const { mock } = await pressedStart((): Response => {
      throw 'socket hang up';
    });
    expect(textOf(STATUS)).toContain('socket hang up');
    expect(one(`${ROW} [data-part='source-error']`).textContent).toContain('socket hang up');
    expect(pickButton().disabled).toBe(false);
    await tick(9_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(0);
  });

  it('states a start the server refused, in the region and beside the box, and leaves the control pressable', async () => {
    const { root, mock } = await pressedStart(refused);
    expect(textOf(STATUS)).toContain("a pick window is open for 'tech'");
    expect(one(`${ROW} [data-part='source-error']`, root).textContent).toContain("a pick window is open for 'tech'");
    expect(pickButton().disabled).toBe(false);
    await tick(9_000);
    expect(callsOf(mock, 'GET', '/api/pick')).toBe(0);
  });
});
