import { normalizeText } from './normalize.ts';
import type { DiffOp, EditReport } from './types.ts';

const MAX_LCS_CELLS = 1_500_000;

const cell = (arr: Uint32Array, i: number): number => arr[i] ?? 0;
const tok = (arr: readonly string[], i: number): string => arr[i] ?? '';

/** Tokens keep whitespace runs so the rendered diff reads like the article. */
export const tokenize = (text: string): string[] => text.match(/[^\s]+|\s+/g) ?? [];

const coarse = (before: string, after: string): DiffOp[] => {
  const ops: DiffOp[] = [];
  if (before.length > 0) ops.push({ type: 'delete', text: before });
  if (after.length > 0) ops.push({ type: 'insert', text: after });
  return ops;
};

const mergeOps = (ops: readonly DiffOp[]): DiffOp[] => {
  const out: DiffOp[] = [];
  for (const op of ops) {
    if (op.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.type === op.type) last.text += op.text;
    else out.push({ type: op.type, text: op.text });
  }
  return out;
};

/**
 * Word-level diff. Stealth edits are the valuable signal of this whole tool
 * (a published story changes and the feed says nothing), so the paper has to
 * show *what changed*, not "edited 14:32".
 */
export const wordDiff = (before: string, after: string): DiffOp[] => {
  if (before === after) return before.length === 0 ? [] : [{ type: 'equal', text: before }];

  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length === 0) return [{ type: 'insert', text: after }];
  if (b.length === 0) return [{ type: 'delete', text: before }];
  if ((a.length + 1) * (b.length + 1) > MAX_LCS_CELLS) return coarse(before, after);

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const len = new Uint32Array((n + 1) * width);
  // 0 = diagonal (token equal), 1 = up (token deleted from `before`), 2 = left (token inserted)
  const dir = new Uint8Array((n + 1) * width);

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const idx = i * width + j;
      if (tok(a, i - 1) === tok(b, j - 1)) {
        len[idx] = cell(len, (i - 1) * width + (j - 1)) + 1;
        dir[idx] = 0;
        continue;
      }
      const up = cell(len, (i - 1) * width + j);
      const left = cell(len, i * width + (j - 1));
      if (up >= left) {
        len[idx] = up;
        dir[idx] = 1;
      } else {
        len[idx] = left;
        dir[idx] = 2;
      }
    }
  }

  const reversed: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const idx = i * width + j;
    if (i > 0 && j > 0 && dir[idx] === 0) {
      reversed.push({ type: 'equal', text: tok(a, i - 1) });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (j === 0 || dir[idx] === 1)) {
      reversed.push({ type: 'delete', text: tok(a, i - 1) });
      i -= 1;
    } else {
      reversed.push({ type: 'insert', text: tok(b, j - 1) });
      j -= 1;
    }
  }
  return mergeOps(reversed.reverse());
};

const weightOf = (ops: readonly DiffOp[], type: DiffOp['type']): number =>
  ops.reduce((sum, op) => (op.type === type ? sum + normalizeText(op.text).replace(/\s/g, '').length : sum), 0);

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * `meaningful` is the typo-filter: a 600-word paragraph with two characters
 * changed is a correction, not news. 6% of non-whitespace characters is the
 * default; it is per-source configurable because small summaries churn.
 */
export const editReport = (before: string, after: string, minChangeRatio = 0.06): EditReport => {
  const ops = wordDiff(before, after);
  const added = weightOf(ops, 'insert');
  const removed = weightOf(ops, 'delete');
  const base = Math.max(
    1,
    normalizeText(before).replace(/\s/g, '').length,
    normalizeText(after).replace(/\s/g, '').length,
  );
  const similarity = clamp01(1 - (added + removed) / base);
  return {
    ops,
    added,
    removed,
    similarity,
    meaningful: similarity <= 1 - minChangeRatio,
  };
};

export const renderDiffText = (ops: readonly DiffOp[]): string =>
  ops.map((op) => (op.type === 'insert' ? `+${op.text}` : op.type === 'delete' ? `-${op.text}` : op.text)).join('');
