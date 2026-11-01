# Repository Setup

One-time maintainer setup for publishing `@developmentsprint/nuxt-openfga`.
Complete the steps in order. Nothing here is automated, because each step needs
an authenticated maintainer.

## 1) GitHub repository

1. Create `DevelopmentSprint/nuxt-openfga` as a **public** repository with no
   template, README or license (they already exist here).
2. Push `main`: `git push -u origin main`.
3. In **Settings → Code security**, enable:
   - Dependency graph (required by the `dependency-review` workflow)
   - Dependabot alerts and security updates
   - **Private vulnerability reporting** (`SECURITY.md` and the issue
     templates send reporters there)
   - Secret scanning and push protection
4. In **Settings → Actions → General**, set workflow permissions to
   **Read repository contents** and allow GitHub Actions to create pull
   requests. The `changesets` workflow needs this to open version PRs.

## 2) Branch protection

After the first CI run on `main` has registered the check names:

```bash
gh auth login
scripts/oss/setup-branch-protection.sh DevelopmentSprint/nuxt-openfga
```

The script requires the `validate`, `parity` and `dependency-review` checks,
one approving review with stale-review dismissal, linear history and
conversation resolution. It forbids force pushes and deletion.

## 3) First npm release

npm trusted publishing can only be configured for a package that already
exists, so the first version is published by hand.

1. Merge the version PR that Changesets opens for the pending changeset, so
   `package.json` holds the release version.
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

### Later releases

1. Add changesets in feature PRs (`pnpm changeset`). On `main`, the
   `changesets` workflow opens a version PR. Merge it.
2. Create and publish a GitHub release with tag `vX.Y.Z`, or
   `@developmentsprint/nuxt-openfga@X.Y.Z`, targeting the merged commit. Its
   version must match `package.json`. Drafts and prereleases are skipped.
3. The **Publish npm release** workflow verifies that the tag matches the
   commit on `main`, runs lint, typecheck, tests and the build, packs the
   tarball, checks its file list against an allowlist, scans it with gitleaks,
   then publishes that exact tarball with provenance over OIDC.

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
