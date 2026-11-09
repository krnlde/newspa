import type { RssSource } from 'newspa-config';
import type { PickedItem } from 'newspa-core';
import type { RawFields } from './item.ts';
import { buildItem, unusableReason } from './item.ts';
import type { SkippedItem } from './results.ts';

/**
 * Item nodes → `PickedItem`s, shared by RSS 2.0, RSS 1.0 and Atom: those
 * formats differ in where a link lives, not in what a story is.
 *
 * An unusable node is **counted and named**, never dropped in silence (rule 5).
 * A feed that starts shipping `<entry>` without a `<link>` has restructured,
 * and a skip count in the health note is the only evidence that will survive to
 * the paper.
 */

export interface FeedItems {
  readonly items: PickedItem[];
  readonly skipped: SkippedItem[];
  /** Item nodes seen, including the ones the mapping dropped. */
  readonly seen: number;
  /** True when `maxItems` cut the list. */
  readonly capped: boolean;
}

export const buildItems = (
  spec: RssSource,
  nodes: readonly Record<string, unknown>[],
  feed: Record<string, unknown> | null,
  linkOf: (node: Record<string, unknown>) => string,
  fieldsOf: (node: Record<string, unknown>, feed: Record<string, unknown> | null, link: string) => RawFields,
): FeedItems => {
  const items: PickedItem[] = [];
  const skipped: SkippedItem[] = [];
  const limit = Math.min(nodes.length, spec.maxItems);
  for (const [index, node] of nodes.entries()) {
    if (index >= limit) continue;
    const fields = fieldsOf(node, feed, linkOf(node));
    const why = unusableReason(fields);
    if (why !== null) {
      skipped.push({ index, why });
      continue;
    }
    items.push(buildItem(spec, fields));
  }
  return { items, skipped, seen: nodes.length, capped: nodes.length > limit };
};
