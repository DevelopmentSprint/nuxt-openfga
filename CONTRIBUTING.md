# Contributing

Thanks for helping improve nuxt-openfga. Bug reports, fixes and documentation
improvements are all welcome.

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker, optional, to run the parity tests against a real OpenFGA server

## Setup

```bash
pnpm install
pnpm dev:prepare
```

## Development

```bash
pnpm dev        # playground at http://localhost:3000, in memory mode
```

The playground in `playground/` uses a small org/document model. Pick a user
from the menu to see `<Can>` and `requireRelation` respond.

## Tests

```bash
pnpm test       # unit tests
pnpm test:e2e   # builds the playground and drives it over HTTP
```

The parity suite in `test/integration/` evaluates the same model and tuples
with the in-memory evaluator and a real OpenFGA server. It skips when no
server is reachable. To run it:

```bash
docker run -d --rm --name openfga -p 8080:8080 openfga/openfga run
OPENFGA_API_URL=http://localhost:8080 OPENFGA_REQUIRE_SERVER=1 pnpm vitest run test/integration
docker stop openfga
```

CI runs it against a pinned OpenFGA release on every pull request.

## Quality gates

Run these before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Pull requests

- Keep each pull request to one change, and explain why it is needed.
- Include tests for behavior changes. Authorization fixes need a regression
  test that fails without the fix.
- If you change the in-memory evaluator, extend the parity suite so the new
  behavior is checked against OpenFGA.
- Keep server-only values out of `runtimeConfig.public`.
- Add a changeset for any change visible to package users: `pnpm changeset`.

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
