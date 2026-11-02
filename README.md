# @developmentsprint/nuxt-openfga

[![npm version](https://img.shields.io/npm/v/@developmentsprint/nuxt-openfga)](https://www.npmjs.com/package/@developmentsprint/nuxt-openfga)
[![CI](https://github.com/DevelopmentSprint/nuxt-openfga/actions/workflows/ci.yml/badge.svg)](https://github.com/DevelopmentSprint/nuxt-openfga/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[OpenFGA](https://openfga.dev) authorization for [Nuxt](https://nuxt.com).

**Documentation: <https://developmentsprint.github.io/nuxt-openfga/>**

- **Server helpers** for checks, writes and `listObjects`, auto-imported into
  Nitro, with a per-process decision cache.
- **Route guards** (`requireRelation`) that return 401, 400 or 403 before your
  handler runs.
- **UI gating** with a `<Can>` component and `useCan` composable, resolved
  during SSR so gated content does not pop in after hydration.
- **Contextual tuples** so role facts you already store reach OpenFGA without
  being duplicated as tuples.
- **Memory mode**: an in-memory evaluator for tests and local development
  with no OpenFGA server. CI checks it against a real OpenFGA server.
- **Optional model deployment** of your `.fga` file when the server starts,
  for servers that accept DSL bodies.

The module has no knowledge of your model's types. Your application supplies
the model, tuples and authentication.

## Requirements

- Nuxt 4
- Node.js 22+
- An OpenFGA server or compatible managed service. Memory mode needs none.

## Installation

```bash
pnpm add @developmentsprint/nuxt-openfga
```

`@openfga/sdk` pins an exact axios version that has open security advisories
(`@openfga/sdk@0.9.7` pins `axios@1.19.0`; 1.20.0 fixes them). Until the SDK
updates it, lift it in your app. The module's tests pass against axios 1.21.

```yaml
# pnpm-workspace.yaml
overrides:
  axios: ^1.20.0
```

With npm, use `"overrides": { "axios": "^1.20.0" }` in `package.json`; with
Yarn, `"resolutions"`.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@developmentsprint/nuxt-openfga'],
  openfga: {
    apiUrl: 'http://localhost:8080',
  },
})
```

```bash
# .env
OPENFGA_STORE_ID=01J...
OPENFGA_MODEL_ID=01J...
```

## Connect your authentication

The module does not authenticate users. It reads the signed-in user's id from
`event.context`, by default at `event.context.user.id`, and checks it as the
subject `user:<id>`. Set that value in your own server middleware, or point
`userIdPath` at wherever your auth layer already puts it:

```ts
export default defineNuxtConfig({
  openfga: {
    userIdPath: 'auth.session.userId', // reads event.context.auth.session.userId
  },
})
```

Requests without a user id are treated as anonymous. `requireRelation` and
`/api/_authz/check` respond 401 to them.

## Enforce on the server

### Route guards

```ts
// server/api/documents/[id].get.ts
export default defineEventHandler({
  onRequest: [requireRelation('document', 'viewer', event => getRouterParam(event, 'id')!)],
  handler: async (event) => {
    // Only reached when the user is a viewer of document:<id>.
  },
})
```

`requireRelation(objectType, relation, getObjectId, getContextualTuples?)`
responds 401 without a user, 400 when `getObjectId` returns nothing, and 403
when the check fails.

### Helpers

All helpers are auto-imported in your Nitro server code.

```ts
await checkAccess(userId, 'viewer', 'document', 'roadmap') // → boolean
await checkAccessOrThrow(userId, 'editor', 'document', 'roadmap') // 403 on deny
await listObjects(userId, 'viewer', 'document') // → ['document:roadmap', ...]
await writeRelationship(userId, 'owner', 'document', 'roadmap')
await deleteRelationship(userId, 'owner', 'document', 'roadmap')
```

The helpers above take a bare user id and add the `user:` prefix. Each has a
`...ForSubject` form that takes any OpenFGA subject verbatim, such as a
userset or a non-user type:

```ts
await writeRelationshipForSubject('group:eng#member', 'viewer', 'document', 'roadmap')
await checkAccessForSubject('team:platform', 'can_invoke', 'tool', 'deploy')
await listObjectsForSubject('user:*', 'viewer', 'document')
```

| Helper | Subject form |
|---|---|
| `checkAccess` | `checkAccessForSubject` |
| `checkAccessOrThrow` | `checkAccessForSubjectOrThrow` |
| `listObjects` | `listObjectsForSubject` |
| `writeRelationship` | `writeRelationshipForSubject` |
| `deleteRelationship` | `deleteRelationshipForSubject` |
| `invalidateCache` | `invalidateCacheForSubject` |

For anything else, `useOpenFGAClient()` returns the underlying
[`@openfga/sdk`](https://github.com/openfga/js-sdk) `OpenFgaClient`.

## Gate the UI

```vue
<template>
  <Can relation="editor" object-type="document" :object-id="doc.id">
    <EditButton />
    <template #fallback>
      <span>Read only</span>
    </template>
  </Can>
</template>
```

`<Can>` renders its default slot when the check allows, `#pending` while the
check is in flight, and `#fallback` otherwise. Both named slots default to
nothing.

`useCan` is the composable underneath. Its arguments may be refs or getters,
and the check reruns when they change:

```ts
const { allowed, pending, error, refresh } = useCan('editor', 'document', () => props.id)
```

Both call `POST /api/_authz/check`, which the module registers. The endpoint
only answers questions about the signed-in user, and ignores any subject in the
request body. Checks run during SSR, and components asking the same question
on one page share a single request.

The endpoint enforces OpenFGA's own field limits and responds 400 to anything
OpenFGA would reject: `relation` up to 50 characters and `objectType` up to
254, neither containing `:`, `#`, `@` or whitespace, and `objectType:objectId`
up to 256 characters with no whitespace. This keeps arbitrary input out of the
shared decision cache without rejecting any id OpenFGA accepts.

> **Hiding UI is not access control.** Every endpoint that returns or changes
> protected data must still enforce the relation with `requireRelation` or
> `checkAccessOrThrow`.

## Contextual tuples

Contextual tuples are added to the tuple set for a single check and never
stored. Use them for facts your application already owns. For example, map a
row in your roles table to an `admin` relation:

```ts
// server/middleware/authz-context.ts
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  if (!userId) return
  const roles = await loadRoles(userId) // your code
  event.context.openfgaContextualTuples = roles.includes('admin')
    ? [{ user: `user:${userId}`, relation: 'admin', object: 'org:acme' }]
    : []
})
```

`/api/_authz/check` includes the tuples found at `contextualTuplesKey`
(default `openfgaContextualTuples`), so `<Can>` sees the same answer as your
server. Route guards include them only when you ask, which keeps each guard's
inputs explicit:

```ts
requireRelation('org', 'admin', () => 'acme', getAuthzContextualTuples)
```

Server helpers accept them per call: `checkAccess(id, rel, type, objId, { contextualTuples })`.
A value at that key that is not an array of `{ user, relation, object }`
causes an error, so a mistake surfaces instead of changing decisions silently.

## Configuration

| Option | Env var | Default | Description |
|---|---|---|---|
| `apiUrl` | `OPENFGA_API_URL` | — | OpenFGA API base URL. Required in server mode. |
| `storeId` | `OPENFGA_STORE_ID` | — | Store to use. |
| `modelId` | `OPENFGA_MODEL_ID` | — | Authorization model to pin. Leave unset to use the store's latest model, or the one deployed at startup. |
| `headers` | `OPENFGA_HEADERS` | `{}` | Static headers sent with every request, such as an API token for a managed service. |
| `cacheMaxEntries` | — | `10000` | Maximum cached decisions per server process. |
| `cacheTtlMs` | — | `30000` | Lifetime of a cached decision. |
| `autoDeployModel` | — | `false` | Deploy `modelFile` when the server starts. See [Model deployment](#model-deployment). |
| `modelFile` | `OPENFGA_MODEL_FILE` | `openfga/model.fga` | DSL model path, relative to the server's working directory. |
| `userIdPath` | — | `user.id` | Path to the user id on `event.context`. |
| `contextualTuplesKey` | — | `openfgaContextualTuples` | Key on `event.context` holding per-request contextual tuples. |
| — | `OPENFGA_MODE` | `server` | `server` or `memory`. See [Testing with memory mode](#testing-with-memory-mode). |

Each env var also has a `NUXT_`-prefixed alias, such as
`NUXT_OPENFGA_API_URL`, following Nuxt's
[runtime config convention](https://nuxt.com/docs/guide/going-further/runtime-config#environment-variables).
When both forms are set, the `NUXT_` form wins. Env values override
`nuxt.config` values.

`OPENFGA_HEADERS` is a comma-separated list of `Key: Value` pairs:

```bash
OPENFGA_HEADERS="Authorization: Bearer <token>, X-Tenant: acme"
```

Values containing commas cannot be expressed this way; set them with the
`headers` option instead. Env headers override option headers with the same
name. Malformed entries are skipped and logged by position only, never by
value. All configuration is server-only and never sent to the browser.

## Model deployment

Deploy your model with the [`fga` CLI](https://github.com/openfga/cli), as
with any OpenFGA application:

```bash
fga model write --store-id "$OPENFGA_STORE_ID" --file openfga/model.fga
```

If your server accepts DSL bodies on
`POST /stores/:storeId/authorization-models` with
`Content-Type: application/x-openfga-dsl`, the module can deploy for you
instead. Set `autoDeployModel: true`, and a Nitro startup plugin will read
`modelFile`, send it, and use the returned model id. It sends an
`Idempotency-Key` derived from the file's contents, so servers that honor the
key do not create a new model on every restart. **The upstream OpenFGA server
accepts only JSON models**, which is why this is off by default.

The plugin reads `apiUrl`, `storeId` and `modelId` from env vars or
`nuxt.config`, like the server helpers. It skips deployment when a model id is
pinned (`OPENFGA_MODEL_ID` or `modelId`), when `OPENFGA_MODE=memory`, and when
the URL or store id is missing. Failures are
logged and do not stop the server; checks fail until the model is available.

In production, the model file is read from disk at startup. Make sure it is
present relative to the server's working directory, or set
`OPENFGA_MODEL_FILE` to an absolute path.

## Caching

`checkAccess` and `checkAccessForSubject` cache each decision in the server
process, keyed by subject, relation, object and any contextual tuples, for
`cacheTtlMs`. When the cache is full, the least recently used entry is
evicted.

A write or delete clears every cached decision on that object, for all
subjects, because any tuple on an object can change other subjects' access
through wildcards, usersets or parent relations. A check that was already
waiting on OpenFGA when the write happened is not cached.

Writes cannot reach decisions on *other* objects. Adding `user:bob` as a
member of `group:eng` does not invalidate a cached decision about a document
that `group:eng#member` can view. After changes like that:

```ts
clearAuthzCache()                                      // everything
invalidateCacheForSubject('user:bob', 'document', 'x') // one subject and object
```

The cache is per process. With several server instances, a revoked grant can
persist on other instances for up to `cacheTtlMs`. Lower the TTL, or set
`cacheMaxEntries: 0` to disable caching, if that window is too long.
`listObjects` is never cached.

## Testing with memory mode

With `OPENFGA_MODE=memory`, `useOpenFGAClient()` returns an in-memory client
instead of connecting to a server. Load a model and tuples before the first
check:

```ts
// server/plugins/openfga-memory.ts (test or dev only)
import model from '../../openfga/model.json' // fga model transform --file openfga/model.fga

export default defineNitroPlugin(() => {
  if (!isMemoryMode()) return
  loadMemoryStore({
    model,
    tuples: [{ user: 'user:alice', relation: 'owner', object: 'document:roadmap' }],
  })
})
```

To test authorization rules outside Nuxt, for example to check that your
model grants what you expect, use the pure evaluator from the `/memory` entry
point. It has no Nuxt dependencies:

```ts
import { evaluateCheck, evaluateListObjects } from '@developmentsprint/nuxt-openfga/memory'

expect(evaluateCheck(model, tuples, 'user:bob', 'viewer', 'document', 'handbook')).toBe(true)
expect(evaluateListObjects(model, tuples, 'user:bob', 'viewer', 'document')).toEqual(['document:handbook'])
```

The same entry point exports `loadMemoryStore`, `resetMemoryStore` and
`MemoryFgaClient`, which implements the `check`, `listObjects` and `write`
methods of `OpenFgaClient` against the loaded store. For tests that go
through your server routes, run your app in memory mode with
[`@nuxt/test-utils`](https://nuxt.com/docs/getting-started/testing).

The evaluator supports direct relations (`this`), `computedUserset`,
`tupleToUserset`, `union`, `intersection` and `difference`, plus wildcard
(`user:*`) and userset (`group:eng#member`) subjects. Contextual tuples apply
to checks. Its limitations:

- Conditions (ABAC) are not supported.
- `listObjects` only considers objects that appear in at least one tuple.
- Resolution depth is capped at 32. A check that exceeds it throws instead of
  answering, so a cut-off branch can never grant access.
- State lives in the process and is lost on restart.

Like OpenFGA, the memory client rejects writing a tuple that already exists
and deleting one that does not, and applies nothing when any part of a write
is rejected. Wildcards (`group:*`) match concrete objects of their type but
not usersets (`group:eng#member`).

Memory mode is not intended for production. CI evaluates a shared model and
tuple set with both the evaluator and a pinned OpenFGA release, and fails if
they disagree.

## TypeScript

Public types are exported from `@developmentsprint/nuxt-openfga/types`:

```ts
import type { AuthorizationModel, ContextualTupleKey, MemoryTuple, ModuleOptions } from '@developmentsprint/nuxt-openfga/types'
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as
described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
