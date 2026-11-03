# @developmentsprint/nuxt-openfga

## 0.1.2

### Patch Changes

- 2764fdb: The README is now a short overview with a quick start, and links to the new documentation site at https://developmentsprint.github.io/nuxt-openfga/ for everything else.

## 0.1.1

### Patch Changes

- a0a41ff: `/api/_authz/check` now responds 400 to a relation, object type or object id that OpenFGA itself would reject (its length and character limits), so arbitrary input can no longer churn the shared decision cache.
- 0468d15: The memory evaluator memoizes cycle-free subproblems within a check or `listObjects` call, so models where many paths reach the same relation (diamonds) no longer take exponential time. Answers and depth-cap errors are unchanged.

## 0.1.0

### Minor Changes

- 45c273b: Initial public release. The module was extracted from a production Nuxt application and generalized:

  - Server helpers for checks, writes, deletes and `listObjects` in user and subject forms, with an LRU decision cache.
  - `requireRelation` route guards and the `/api/_authz/check` endpoint behind `<Can>` and `useCan`.
  - `userIdPath` and `contextualTuplesKey` options to fit any authentication layer.
  - Memory mode with an in-memory evaluator, checked against OpenFGA in CI, and a `/memory` entry point for unit tests.
  - Opt-in startup deployment of a DSL model (`autoDeployModel`) for servers that accept DSL bodies.

### Patch Changes

- 14a4be0: Require `@openfga/sdk` 0.9.7 or later, and document the axios override needed until the SDK stops pinning a vulnerable axios.
