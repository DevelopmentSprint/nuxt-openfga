# Security Policy

nuxt-openfga sits on your application's authorization path. A defect here can
grant access that your OpenFGA model denies, so please report suspected
vulnerabilities privately.

## Supported versions

Security fixes go into the latest released minor version. Before 1.0, that is
the latest `0.x` release.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Report it through
[GitHub private vulnerability reporting](https://github.com/DevelopmentSprint/nuxt-openfga/security/advisories/new).

Please include:

- the affected version and configuration (server or memory mode, relevant
  module options)
- a minimal reproduction: model, tuples and the request that returns the wrong
  decision
- the impact you observed or expect

Examples of what we treat as vulnerabilities:

- a check, guard or `/api/_authz/check` response that allows what the model
  denies
- a cached decision that outlives a write or delete it should have invalidated
- a way for a client to choose the subject of `/api/_authz/check`
- configuration or headers leaking to the browser or into logs

The in-memory evaluator is meant for tests and development. A disagreement
between it and an OpenFGA server is a bug, but not a vulnerability, unless
memory mode is reachable in production by default.

## What to expect

- Acknowledgment within 3 business days.
- An assessment and planned fix timeline within 7 business days.
- A fix released before public disclosure. We will credit you in the advisory
  unless you ask us not to.
