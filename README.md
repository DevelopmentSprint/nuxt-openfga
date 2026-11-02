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

## Quick start

```bash
pnpm add @developmentsprint/nuxt-openfga
```

`@openfga/sdk@0.9.7` pins `axios@1.19.0`, which has open security advisories.
Until the SDK updates it, lift it in your app (npm: `overrides`, Yarn:
`resolutions`):

```yaml
# pnpm-workspace.yaml
overrides:
  axios: ^1.20.0
```

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

The module reads the signed-in user's id from `event.context.user.id`; set it
in your auth middleware or point `userIdPath` elsewhere. Then enforce on the
server and gate the UI:

```ts
// server/api/documents/[id].get.ts
export default defineEventHandler({
  onRequest: [requireRelation('document', 'viewer', event => getRouterParam(event, 'id')!)],
  handler: async (event) => { /* only reached by viewers */ },
})
```

```vue
<Can relation="editor" object-type="document" :object-id="doc.id">
  <EditButton />
</Can>
```

## Documentation

- [Installation](https://developmentsprint.github.io/nuxt-openfga/getting-started/installation)
  and [authentication](https://developmentsprint.github.io/nuxt-openfga/getting-started/authentication)
- Guide: [server](https://developmentsprint.github.io/nuxt-openfga/guide/server),
  [UI](https://developmentsprint.github.io/nuxt-openfga/guide/ui),
  [contextual tuples](https://developmentsprint.github.io/nuxt-openfga/guide/contextual-tuples),
  [caching](https://developmentsprint.github.io/nuxt-openfga/guide/caching),
  [model deployment](https://developmentsprint.github.io/nuxt-openfga/guide/model-deployment),
  [memory mode](https://developmentsprint.github.io/nuxt-openfga/guide/memory-mode)
- Reference: [configuration](https://developmentsprint.github.io/nuxt-openfga/reference/configuration),
  [API](https://developmentsprint.github.io/nuxt-openfga/reference/api),
  [TypeScript](https://developmentsprint.github.io/nuxt-openfga/reference/typescript)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as
described in [SECURITY.md](SECURITY.md). The documentation site lives in
[`docs/`](docs/).

## License

[MIT](LICENSE)
