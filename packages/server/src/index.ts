/**
 * `newspa-server`: the process that fetches, scores and serves the paper.
 *
 * This slice is the read side — database rows to the `StateResponse` the paper
 * already consumes. The pipeline, scheduler, routes and SSE land here as
 * they are built, and each one enters through this barrel: `package.json`'s
 * `exports` names `./src/index.ts`, so a module that is not re-exported here is
 * not part of the package.
 *
 * Unlike `packages/core` and `packages/paper`, this package is the I/O layer:
 * `node:*` is allowed, and `node:sqlite` is reached only through `newspa-db`.
 */
export { type EditionInput, editionOf } from './edition.ts';
export { pollOne } from './poll.ts';
export { pollDepsOf } from './pollDeps.ts';
export type { ItemPass, PollDeps, PollResult } from './pollTypes.ts';
export {
  DEFAULT_STATE_EVENT_LIMIT,
  DEFAULT_STATE_ITEM_LIMIT,
  datelineFor,
  type StateDeps,
  stateOf,
} from './state.ts';
