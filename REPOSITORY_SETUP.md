# Repository Setup

One-time maintainer setup for publishing `@developmentsprint/nuxt-openfga`.
Complete the steps in order. Nothing here is automated, because each step needs
an authenticated maintainer.

## 1) GitHub repository

1. Create `DevelopmentSprint/nuxt-openfga` as a **public** repository with no
   template, README or license (they already exist here).
2. Push both long-lived branches: `git push -u origin main develop`.
3. In **Settings → General**, set the default branch to `develop`. Pull
   requests, Dependabot updates and the repository landing page then follow
   the git-flow integration branch.
4. In **Settings → Code security**, enable:
   - Dependency graph (required by the `dependency-review` workflow)
   - Dependabot alerts and security updates
   - **Private vulnerability reporting** (`SECURITY.md` and the issue
     templates send reporters there)
   - Secret scanning and push protection
5. In **Settings → Actions → General**, set workflow permissions to
   **Read repository contents** and allow GitHub Actions to create pull
   requests. The `changesets` workflow needs this to open version PRs.

## 2) Branch protection

After the first CI run has registered the check names, protect both
long-lived branches:

```bash
gh auth login
scripts/oss/setup-branch-protection.sh DevelopmentSprint/nuxt-openfga main
scripts/oss/setup-branch-protection.sh DevelopmentSprint/nuxt-openfga develop
```

The script requires the `validate`, `parity` and `dependency-review` checks,
one approving review with stale-review dismissal, and conversation
resolution. It forbids force pushes and deletion. It does not require linear
history, because git-flow's release and back-merges are merge commits.

## 3) First npm release

npm trusted publishing can only be configured for a package that already
exists, so the first version is published by hand.

1. Merge the version PR that Changesets opens on `main` for the pending
   changeset, so `package.json` holds the release version, then merge `main`
   back into `develop`.
2. From a clean checkout of that commit on `main`, run the same gates as the
   release workflow, then publish:

   ```bash
   pnpm install --frozen-lockfile
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   npm publish --access public
   ```

   This needs an npm account with publish rights in the `developmentsprint`
   organization. Provenance cannot be attached to a local publish.
3. Tag the commit `vX.Y.Z` and create a matching GitHub release, so the history
   lines up with later automated releases.

## 4) npm trusted publisher

On `https://www.npmjs.com/package/@developmentsprint/nuxt-openfga/access`,
under **Publishing access**, add a GitHub Actions trusted publisher:

- Owner: `DevelopmentSprint`
- Repository: `nuxt-openfga`
- Workflow file: `npm-publish.yml`
- Environment: _(leave blank)_

Then set **Publishing access** to require two-factor authentication and
disallow tokens. No npm token belongs in GitHub secrets or workflow files. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

### Later releases (git-flow)

1. Feature PRs into `develop` include their changesets (`pnpm changeset`).
2. Cut a release: branch `release/X.Y.Z` from `develop`, open a PR into
   `main`, and merge it once checks pass.
3. On `main`, the `changesets` workflow opens a version PR that bumps
   `package.json` and writes `CHANGELOG.md`. Merge it.
4. Create and publish a GitHub release with tag `vX.Y.Z`, or
   `@developmentsprint/nuxt-openfga@X.Y.Z`, targeting the merged commit. Its
   version must match `package.json`. Drafts and prereleases are skipped.
5. The **Publish npm release** workflow verifies that the tag matches the
   commit on `main`, runs lint, typecheck, tests and the build, packs the
   tarball, checks its file list against an allowlist, scans it with gitleaks,
   then publishes that exact tarball with provenance over OIDC.
6. Merge `main` back into `develop`, so the version bump, the changelog and
   the consumed changesets reach the integration branch.

Hotfixes branch from `main` (`hotfix/X.Y.Z`), merge into `main` through the
same steps, and are then merged back into `develop`.

Create releases from a maintainer's GitHub session or CLI. Releases created by
another workflow's `GITHUB_TOKEN` do not trigger publishing. If validation
fails, fix it in a new version; never try to overwrite a published version.

## 5) Codecov

Enable `DevelopmentSprint/nuxt-openfga` in the DevelopmentSprint Codecov
organization and allow tokenless uploads for public repositories, so fork and
Dependabot PRs report coverage. Pushes to `main` upload with OIDC from the
dedicated `coverage` job; no `CODECOV_TOKEN` secret is used.

After the first build on `main`, check that the
[coverage badge](https://codecov.io/gh/DevelopmentSprint/nuxt-openfga/branch/main/graph/badge.svg)
shows a percentage. Coverage upload failures do not fail CI, so a green run is
not proof that the upload worked.
