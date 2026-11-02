# Agent Instructions

`AGENTS.md` and `CLAUDE.md` must stay byte-identical. Edit both in the same
change.

## Private tracker state — never publish

Beads, BeadRoad, Dolt, and CASS (procedural memory) state is local-only. This rule overrides tracker
export, synchronization, backup, and commit instructions elsewhere in this file
or in skills. Never publish database files, metadata, interaction logs, credentials,
JSONL/SQL exports, or backups through Git, CI artifacts, releases, or docs sites,
including renamed or nested copies. Public issues may contain deliberately
reviewed summaries, never private tracker exports.

Keep `.beads/`, `.beadroad/`, `.dolt/`, `dolt/`, `doltdb/`, `embeddeddolt/`,
`proxieddb/`, `.cass/`, `.beads-credential-key`, and `.beads.gate.lock` ignored. Do not use
forced staging or a Git-backed tracker sync branch. Run `bd --sandbox` and keep
`dolt.local-only=true`, `dolt.auto-push=false`, `backup.git-push=false`, and
`export.git-add=false`. Preserve local databases; do not delete them to pass checks.

Run `bash scripts/check-private-tracker.sh` before committing. Commit hooks and CI
check the index; the push hook checks outgoing history against a freshly fetched
named destination.

## Workflow

Use the `throughline` skill for kickoff, implementation, review and closeout.
Beads (`bd --sandbox`) is the tracker; branches are
`feature/<bead_id>_<short_name>` in worktrees under `.worktrees/`.

Branching is git-flow. `develop` is the integration branch and the default
branch: feature branches start from it and merge back into it. `main` only
receives `release/*` and `hotfix/*` merges, and `main` is merged back into
`develop` after every release.

- Push, publish, tag or release only with the maintainer's explicit approval.
  Completing work does not authorize any of them.
- `main` and `develop` are protected by rulesets (`scripts/oss/setup-branch-protection.sh`).
  Only organization owners bypass the review gate. Never weaken the rulesets
  or add bypass actors without the maintainer's explicit approval.
- Merge into `develop` only after the maintainer accepts the result. Merging
  `develop` into `main` is a release and needs its own approval.
- Commits follow Conventional Commits, include the bead id, and end with the
  co-author line.

## Commands

```bash
pnpm install
pnpm dev:prepare        # generate playground types
pnpm dev                # playground, memory mode
pnpm lint
pnpm typecheck
pnpm test               # unit + parity (parity skips without a server)
pnpm test:e2e           # builds the playground, drives it over HTTP
pnpm build
pnpm changeset          # for any user-visible change
```

Parity against a real server:

```bash
docker run -d --rm --name openfga -p 8080:8080 openfga/openfga run
OPENFGA_API_URL=http://localhost:8080 OPENFGA_REQUIRE_SERVER=1 pnpm vitest run test/integration
```

## Invariants

- **The module has no knowledge of model types.** Nothing in `src/` may name
  a host application's OpenFGA types or context keys. Configuration covers
  host specifics (`userIdPath`, `contextualTuplesKey`).
- **`/api/_authz/check` only answers for the session user.** Never accept a
  subject from the request.
- **A write or delete must not leave a stale allow decision** on that object,
  for any subject, including decisions made with contextual tuples or computed
  while the write was in flight. Cache keys must be unambiguous.
- **The memory evaluator must never fail open.** When it cannot answer
  (depth cap), it throws. Match OpenFGA's semantics, and verify them against a
  real server, not memory.
- **Evaluator changes need parity coverage.** Extend
  `test/integration/memory-parity.test.ts` so CI compares the new behavior with
  OpenFGA.
- **Only public API is auto-imported.** Add a new server export to
  `SERVER_IMPORTS` in `src/module.ts` deliberately; internal helpers stay out.
- **Pin GitHub Actions by full commit SHA** with a version comment, and check
  that the SHA exists in the action's repository.
- Never log header values or malformed header entries; they can hold secrets.
- Report vulnerabilities through private advisories, never public issues
  (`SECURITY.md`).
