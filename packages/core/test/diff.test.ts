import { describe, expect, it } from 'vitest';
import { editReport, renderDiffText, tokenize, wordDiff } from '../src/diff.ts';
import type { DiffOp } from '../src/types.ts';

const words = (count: number, mutateAt = -1): string =>
  Array.from({ length: count }, (_, i) => (i === mutateAt ? 'CHANGED' : `w${i}`)).join(' ');

describe('tokenize', () => {
  it('keeps whitespace runs so the rendered diff reads like the article', () => {
    expect(tokenize('a  b\nc')).toEqual(['a', '  ', 'b', '\n', 'c']);
    expect(tokenize('   ')).toEqual(['   ']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('wordDiff', () => {
  it('returns one equal op when nothing changed', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ type: 'equal', text: 'same text' }]);
    expect(wordDiff('  ', '  ')).toEqual([{ type: 'equal', text: '  ' }]);
    expect(wordDiff('', '')).toEqual([]);
  });

  it('is a pure insert or a pure delete against an empty side', () => {
    expect(wordDiff('', 'hello world')).toEqual([{ type: 'insert', text: 'hello world' }]);
    expect(wordDiff('hello world', '')).toEqual([{ type: 'delete', text: 'hello world' }]);
  });

  it('shows a replacement as the words that went in and out', () => {
    expect(wordDiff('the quick fox', 'the slow fox')).toEqual([
      { type: 'equal', text: 'the ' },
      { type: 'insert', text: 'slow' },
      { type: 'delete', text: 'quick' },
      { type: 'equal', text: ' fox' },
    ]);
  });

  it('treats whitespace as a token, so a re-space is visible', () => {
    expect(wordDiff('a b', 'a  b')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'insert', text: '  ' },
      { type: 'delete', text: ' ' },
      { type: 'equal', text: 'b' },
    ]);
  });

  it('merges adjacent ops of the same type into one run', () => {
    expect(wordDiff('a x y z b', 'a b')).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'delete', text: ' x y z' },
      { type: 'equal', text: ' b' },
    ]);
  });

  it('merges adjacent insert runs', () => {
    expect(wordDiff('one', 'one two')).toEqual([
      { type: 'equal', text: 'one' },
      { type: 'insert', text: ' two' },
    ]);
  });

  it('falls back to a coarse diff once the LCS grid would exceed 1.5M cells', () => {
    const before = words(613);
    const after = words(613, 300);
    expect(wordDiff(before, after)).toEqual([
      { type: 'delete', text: before },
      { type: 'insert', text: after },
    ]);
  });

  it('still resolves a real diff just under the cell budget', () => {
    const ops = wordDiff(words(612), words(612, 306));
    expect(ops).toHaveLength(4);
    expect(ops.map((op) => op.type)).toEqual(['equal', 'insert', 'delete', 'equal']);
    expect(ops[1]?.text).toBe('CHANGED');
    expect(ops[2]?.text).toBe('w306');
  });
});

describe('editReport', () => {
  it('is not meaningful when two characters of a long paragraph change', () => {
    const list = words(600).split(' ');
    const after = list.map((word, i) => (i === 300 ? `${word}x` : word)).join(' ');
    const report = editReport(words(600), after);
    expect(report.added).toBe(5);
    expect(report.removed).toBe(4);
    expect(report.similarity).toBeGreaterThan(0.99);
    expect(report.meaningful).toBe(false);
  });

  it('is meaningful when the sentences are rewritten', () => {
    const report = editReport('alpha beta gamma delta', 'zulu yankie xray whiskey');
    expect(report.added).toBe(21);
    expect(report.removed).toBe(19);
    expect(report.similarity).toBe(0);
    expect(report.meaningful).toBe(true);
  });

  it('is not meaningful for a whitespace-only change, the cost of an A/B variant', () => {
    const report = editReport('a b', 'a  b');
    expect(report.added).toBe(0);
    expect(report.removed).toBe(0);
    expect(report.similarity).toBe(1);
    expect(report.meaningful).toBe(false);
  });

  it('reports equal text as similarity 1 and clamps a total rewrite at 0', () => {
    expect(editReport('', '')).toEqual({ ops: [], added: 0, removed: 0, similarity: 1, meaningful: false });
    const rewrite = editReport('abc', 'xyz');
    expect(rewrite.similarity).toBe(0);
    expect(rewrite.meaningful).toBe(true);
    expect(editReport('', 'hello').added).toBe(5);
  });

  it('lets a source set its own change ratio', () => {
    expect(editReport('a b c', 'a b c d').meaningful).toBe(true);
    expect(editReport('a b c', 'a b c d', 0.99).meaningful).toBe(false);
  });
});

describe('renderDiffText', () => {
  it('marks inserts with + and deletes with -', () => {
    expect(renderDiffText(wordDiff('the quick fox', 'the slow fox'))).toBe('the +slow-quick fox');
    const ops: readonly DiffOp[] = [
      { type: 'equal', text: 'a ' },
      { type: 'insert', text: 'b' },
      { type: 'delete', text: 'c' },
    ];
    expect(renderDiffText(ops)).toBe('a +b-c');
    expect(renderDiffText([])).toBe('');
  });
});
