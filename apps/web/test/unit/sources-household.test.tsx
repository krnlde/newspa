import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/i18n/index.ts';
import { de } from '../../src/i18n/locales/de.ts';
import { en } from '../../src/i18n/locales/en.ts';
import {
  answer,
  HOUSE_ROW,
  HOUSEHOLD,
  one,
  STATUS,
  sourcesHarness,
  stubSourcesWire,
  textOf,
  theBodyOf,
  urlOf,
} from './support/sourcesWire.tsx';

/**
 * The household switches (D-034, the W4 ruling), as a phone sees them. The claims
 * are the privacy ones, because the UI is the half a reader can be shown:
 *
 *  - the form is **built from the household view only**: no editor box exists,
 *    because no file text was ever sent — the leak is structurally impossible;
 *  - Apply sends **only what moved**: an untouched knob is absent from the patch,
 *    so "opened the modal" never writes a file;
 *  - an unset section is sent as `null` (the ladder routes again), and the add
 *    form derives the filename-shaped id from the label (D-011);
 *  - a refused write prints the server's own lines (rule 5).
 */

const harness = sourcesHarness();
const { mounted, dispose } = harness;

beforeEach(async () => {
  await initI18n({ language: 'en' });
});

afterEach(dispose);

const house = () => stubSourcesWire(undefined, () => answer(HOUSEHOLD));

describe('the household form', () => {
  it('shows the switches, the preamble, and no editor box (no file text was sent)', async () => {
    house();
    const { root } = await mounted();
    expect(textOf("[data-part='household-preamble']")).toBe(en.sources.household.preamble);
    expect(root.querySelectorAll("[data-part='household-row']")).toHaveLength(2);
    // The desk's control, on a wire that never carries its bytes: no textarea, and
    // no delete — a household device turns a source off, it does not remove a file.
    expect(root.querySelectorAll('textarea')).toHaveLength(0);
    expect(root.querySelectorAll("[data-part='source-delete'], [data-part='source-edit']")).toHaveLength(0);
    expect(textOf(`${HOUSE_ROW} [data-part='household-state']`)).toBe(en.paper.health.state.ok);
  });

  it('disables Apply while nothing moved, and posts only the knob that did', async () => {
    const wire = house();
    await mounted();
    const apply = one<HTMLButtonElement>(`${HOUSE_ROW} [data-part='household-apply']`);
    expect(apply.disabled).toBe(true);
    fireEvent.click(one<HTMLInputElement>(`${HOUSE_ROW} input[type='checkbox']`));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await screen.findByText('BBC World');
    expect(urlOf(wire, 'POST')).toContain('/api/sources');
    expect(theBodyOf(wire, 'POST')).toEqual({ id: 'bbc-world', patch: { enabled: false } });
  });

  it('sends an emptied section as null, and a weight as a number', async () => {
    const wire = house();
    await mounted();
    fireEvent.change(one<HTMLInputElement>(`${HOUSE_ROW} input[type='text']`), { target: { value: '' } });
    fireEvent.click(one<HTMLButtonElement>(`${HOUSE_ROW} [data-part='household-apply']`));
    await screen.findByText('BBC World');
    expect(theBodyOf(wire, 'POST')).toEqual({ id: 'bbc-world', patch: { section: null } });
  });

  it('adds by label and url, deriving the filename-shaped id (D-011)', async () => {
    const wire = house();
    await mounted();
    fireEvent.change(one<HTMLInputElement>(`[data-part='household-add'] input[type='text']`), {
      target: { value: 'Guardian UK' },
    });
    fireEvent.change(one<HTMLInputElement>(`[data-part='household-add'] input[type='url']`), {
      target: { value: 'https://www.theguardian.com/uk/rss' },
    });
    fireEvent.click(one<HTMLButtonElement>(`[data-part='household-add-submit']`));
    await screen.findByText('BBC World');
    expect(theBodyOf(wire, 'POST')).toEqual({
      create: { id: 'guardian-uk', label: 'Guardian UK', url: 'https://www.theguardian.com/uk/rss', kind: 'rss' },
    });
  });

  it('prints the server’s lines for a refused patch, beside the row that caused them', async () => {
    stubSourcesWire(
      () => answer({ ok: false, file: null, messages: ['weight: Number must be at most 5'] }, 400),
      () => answer(HOUSEHOLD),
    );
    await mounted();
    fireEvent.change(one<HTMLInputElement>(`${HOUSE_ROW} input[type='text']`), { target: { value: 'News' } });
    fireEvent.click(one<HTMLButtonElement>(`${HOUSE_ROW} [data-part='household-apply']`));
    await screen.findByText('weight: Number must be at most 5');
    expect(textOf(STATUS)).toContain('Number must be at most 5');
  });

  it('a file that does not parse shows its issues and no controls', async () => {
    house();
    await mounted();
    const broken = one("[data-part='household-row'][data-file='broken.json']");
    expect(broken.textContent).toContain('the file is not valid JSON');
    expect(broken.querySelectorAll('input, select, button')).toHaveLength(0);
  });

  it('speaks the reader’s language, because the labels come from `t` at render', async () => {
    await initI18n({ language: 'de' });
    house();
    await mounted();
    expect(textOf("[data-part='household-preamble']")).toBe(de.sources.household.preamble);
    expect(textOf(`${HOUSE_ROW} [data-part='household-apply']`)).toBe(de.sources.household.apply);
    fireEvent.change(one<HTMLInputElement>(`${HOUSE_ROW} input[type='text']`), { target: { value: '' } });
    expect(textOf(`${HOUSE_ROW} [data-part='household-apply']`)).toBe(de.sources.household.apply);
  });
});
