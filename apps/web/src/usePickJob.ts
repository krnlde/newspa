import type { PickStatusResponse } from 'newspa-core';
import type { PickFill, PickJob } from 'newspa-paper';
import { useEffect, useRef, useState } from 'react';
import { pickStatus, startPick } from './api.ts';

/**
 * The pick job (WP6, D-036), as a hook the shell owns because the wire is the shell's.
 *
 * `POST /api/pick` opens a **real Edge window on the machine that runs the server**
 * and answers at once — a request that waits for a cursor dies in a proxy — so the
 * reader's click arrives later, through `GET /api/pick`. Hence the poll: ask every
 * `PICK_POLL_MS` while the report says `running`, and stop at `picked`, at `failed`,
 * when a request errors, and when the modal unmounts (D-035 unmounts the overlay, and
 * a poll that outlives it is a timer spinning at a component that is gone).
 *
 * **A landed pick fills; it never saves.** The report's `text` goes to the open
 * editor as `pickFill`, and SAVE stays the reader's act, through the one validated
 * write path: a click that rewrote a file would make D-011's truth a mouse's side
 * effect. A `failed` report's `sentence` and `messages` go to the panel's status
 * lines — the same region the save and delete answers use — in the server's own
 * words about its own browser, untranslated (D-019, rule 5).
 */
const PICK_POLL_MS = 1_500;

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a report prints: a failure leads with its sentence, a pick with what the merge did. */
const reportOf = (answer: PickStatusResponse): readonly string[] =>
  (answer.state === 'failed' ? [answer.sentence, ...answer.messages] : answer.messages).filter(
    (line) => line.length > 0,
  );

/** The status region takes an `Error`, and the pick's refusals are always one (`RefusalError`). */
const asError = (cause: unknown): Error => (cause instanceof Error ? cause : new Error(wordsOf(cause)));

export const usePickJob = (
  /** The shared status region: the lines the last server answer wrote. */
  report: (lines: readonly string[]) => void,
  /** The same region, for a failure that is an `Error`. */
  failed: (error: Error) => void,
) => {
  /**
   * The pick's two pieces of state, **keyed by source id**: the panel can have two
   * editors open, and a running label or a fill that lands in both speaks for a pick
   * the reader never started (D-036). `pickFill` also carries a **stamp**, not a
   * time: the same text must be able to fill twice (the reader picks, edits, picks
   * again), and the clock belongs to the app, never to the paper (D-019, rule 4).
   */
  const [job, setJob] = useState<PickJob | undefined>(undefined);
  const [pickFill, setPickFill] = useState<PickFill | undefined>(undefined);
  const fills = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The modal's lifetime (D-035): closing it unmounts this component, and a poll
   * that outlives the component is a timer asking a page that has gone away. */
  const alive = useRef(true);

  /**
   * `alive` is the modal's lifetime, and the effect is written as setup **and**
   * teardown: StrictMode invokes an effect twice, so an un-armed setup arm would
   * leave the poll dead for the rest of the modal's life after the first simulated
   * unmount. The teardown clears the pending ask, which is the only timer this
   * component owns.
   */
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
    };
  }, []);

  /** What a report leaves on the page: the job, its lines, and the text to fill. */
  const settlePick = (id: string, answer: PickStatusResponse): void => {
    setJob({ id, state: answer.state });
    const lines = reportOf(answer);
    // A running report has no lines of its own, and `running` is on the control: the
    // last thing the server said stays in the region rather than being blanked.
    if (lines.length > 0) report(lines);
    if (answer.state === 'picked' && answer.text !== null) {
      fills.current += 1;
      setPickFill({ id, text: answer.text, at: String(fills.current) });
    }
  };

  /** One ask. `timer.current` is cleared first: a fired timer is not a pending one. */
  const reportPick = async (id: string): Promise<void> => {
    timer.current = null;
    let answer: PickStatusResponse;
    try {
      answer = await pickStatus(id);
    } catch (cause) {
      // An errored request ends the poll and is stated, never retried in the dark:
      // a 404 here means the process that ran the pick is not the one answering, and
      // a page that kept asking would be rule 5's silent zero with a spinner on it.
      if (!alive.current) return;
      setJob({ id, state: 'failed' });
      failed(asError(cause));
      return;
    }
    if (!alive.current) return;
    settlePick(id, answer);
    if (answer.state === 'running') pollPick(id);
  };

  const pollPick = (id: string): void => {
    timer.current = globalThis.setTimeout(() => {
      void reportPick(id);
    }, PICK_POLL_MS);
  };

  /**
   * The pick, started. A refusal is stated in the status region **and rethrown**, so
   * the editor states it beside the box the reader is looking at — the shape a
   * refused save already has — and the job falls back to `failed`, because the
   * server refused a window, it did not open one.
   */
  const startPicking = async (id: string): Promise<void> => {
    setJob({ id, state: 'running' });
    let answer: PickStatusResponse;
    try {
      answer = await startPick(id);
    } catch (cause) {
      setJob({ id, state: 'failed' });
      failed(asError(cause));
      throw cause;
    }
    settlePick(id, answer);
    // The window is open, so the report is asked for. `POST` answers `running` and
    // nothing else, so there is no arm here for a state a start cannot report: one
    // ask, and the answer says `running`, `picked` or `failed`.
    pollPick(id);
  };

  /** A landed write spends the fill (D-036): see `SourcesSection.afterWrite`. */
  const spendFill = (): void => {
    setPickFill(undefined);
  };

  return { job, pickFill, startPicking, spendFill };
};
