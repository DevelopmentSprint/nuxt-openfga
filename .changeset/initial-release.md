---
"@developmentsprint/nuxt-openfga": minor
---

Initial public release. The module was extracted from a production Nuxt application and generalized:

- Server helpers for checks, writes, deletes and `listObjects` in user and subject forms, with an LRU decision cache.
- `requireRelation` route guards and the `/api/_authz/check` endpoint behind `<Can>` and `useCan`.
- `userIdPath` and `contextualTuplesKey` options to fit any authentication layer.
- Memory mode with an in-memory evaluator, checked against OpenFGA in CI, and a `/memory` entry point for unit tests.
- Startup deployment of a DSL model for servers that accept DSL bodies.
