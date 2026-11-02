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
   **Read repository contents** and leave **Allow GitHub Actions to create
   and approve pull requests** off. The `changesets` workflow opens version
   PRs with a GitHub App token, not `GITHUB_TOKEN` (section 6).

## 2) Branch protection

Rulesets need a public repository on the free plan, so run this right after
the repository becomes public, and after the first CI run has registered the
check names:

```bash
gh auth login
scripts/oss/setup-branch-protection.sh DevelopmentSprint/nuxt-openfga
```

It creates two rulesets on `main` and `develop`, and re-running it updates
them in place:

- **History**, with no bypass for anyone: no force pushes, no branch
  deletion.
- **Review gate**: changes arrive by pull request with one approval, the
  required `validate`, `parity` and `dependency-review` checks, and resolved
  conversations. Stale approvals are dismissed on new pushes.

**Maintainer carve-out.** Organization owners may bypass the review gate,
because GitHub does not allow approving your own pull request. While there is
a single maintainer, that maintainer can still merge locally and push, or
merge a pull request without a second reviewer. The bypass is tied to the
organization-owner role: contributors and ordinary members can never approve
their own changes onto these branches. Linear history is not required,
because git-flow's release and back-merges are merge commits.

The Changesets version PR is opened with a GitHub App token (section 6), so
its required checks run like any other pull request's.

When a second maintainer joins, consider removing the bypass, or moving it to
`pull_request` mode so even owners go through a pull request.

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
   npm publish --access public --provenance=false
   ```

   This needs an npm account with publish rights in the `developmentsprint`
   organization. `publishConfig.provenance` is `true` for CI releases, and a
   local publish cannot generate provenance, so it fails with `Automatic
   provenance generation not supported for provider: null` unless the flag
   overrides it. Command-line flags take precedence over `publishConfig`.
3. Tag the commit `vX.Y.Z` and create a matching GitHub release, so the history
   lines up with later automated releases. Publishing that release runs the
   publish workflow, which stops at its last step with `You cannot publish
   over the previously published versions`. npm raises that error on the
   client after the OIDC exchange, and a failed exchange is not fatal, so the
   run does not prove trusted publishing works; the next release does.

## 4) npm trusted publisher

On `https://www.npmjs.com/package/@developmentsprint/nuxt-openfga/access`,
under **Publishing access**, add a GitHub Actions trusted publisher:

- Owner: `DevelopmentSprint`
- Repository: `nuxt-openfga`
- Workflow file: `npm-publish.yml`
- Environment: _(leave blank)_

The CLI does the same, and shows the result:

```bash
npm trust github @developmentsprint/nuxt-openfga --file npm-publish.yml \
  --repo DevelopmentSprint/nuxt-openfga --allow-publish --allow-stage-publish
npm trust list @developmentsprint/nuxt-openfga
```

Configuring a trusted publisher before the first publish makes npm create a
`0.0.0-stage` placeholder version. Deprecate it after the real release:
`npm deprecate @developmentsprint/nuxt-openfga@0.0.0-stage "Placeholder release; use 0.1.0 or later"`.
Check with `npm trust list` after the first publish, because the entry has
not always survived it.

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

## 6) Changesets version PR App

Version PRs must trigger the required `validate`, `parity` and
`dependency-review` checks. Pull requests opened or updated with a workflow's
`GITHUB_TOKEN` do not trigger other workflows, so the `changesets` workflow
writes the version PR with a short-lived token from the
`developmentsprint-changesets` GitHub App. The workflow's own `GITHUB_TOKEN`
stays read-only.

The App is registered once for the organization (organization **Settings** →
**Developer settings** → **GitHub Apps**): webhook inactive, repository
permissions **Contents** and **Pull requests** read and write, everything else
**No access**, installed on **Only select repositories**. Add
`nuxt-openfga` to that installation.

Credentials use these names, wherever they are stored:

- Variable `CHANGESETS_APP_CLIENT_ID`: the App's Client ID.
- Secret `CHANGESETS_APP_PRIVATE_KEY`: the full contents of a private key
  generated on the App page. Delete the downloaded `.pem` after saving it.

Organization secrets and variables do not reach private repositories on the
free plan. While this repository is private, store both as **repository**
secrets and variables (**Settings → Secrets and variables → Actions**), using a
private key generated for this repository alone. Once it is public, add the
repository to the organization credentials' **Selected repositories**, delete
the repository-level copies, and delete that key on the App page.

The workflow narrows each token to this repository with contents and
pull-request write access, and the token is revoked when the job ends. It is
minted after dependency installation, so install-time lifecycle scripts never
see it. It is not isolated from later steps: changesets/action writes it to
`~/.netrc` before running the `version-packages` script, which can read it.
Keep that script as plain `changeset version`, with no installs, hooks or
third-party tools. The version commit is created through the GitHub API, so
it is signed and attributed to the App. Changesets still does not publish or
create GitHub releases; publishing remains the release flow in section 4.

To rotate the key, generate a new private key on the App page, update the
secret, confirm the next version PR runs its checks, then delete the old key.
If the App or its credentials are unavailable, the workflow fails at **Mint
version PR token** and no version PR is opened.

## 7) Documentation site (GitHub Pages)

The site in `docs/` is built with [Docus](https://docus.dev) and deployed by
`.github/workflows/docs.yml` to
<https://developmentsprint.github.io/nuxt-openfga/>. Pull requests that touch
`docs/` build it; pushes to `main` deploy it, so the site describes the
released version. Run the workflow by hand on `main` to redeploy.

One-time setup, as a repository admin:

```bash
# Publish Pages from GitHub Actions rather than a branch.
gh api -X POST repos/DevelopmentSprint/nuxt-openfga/pages -f build_type=workflow
# The github-pages environment allows only the default branch (develop) to
# deploy until main is added.
gh api -X PUT repos/DevelopmentSprint/nuxt-openfga/environments/github-pages \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/DevelopmentSprint/nuxt-openfga/environments/github-pages/deployment-branch-policies \
  -f name=main -f type=branch
```

The site is served under `/nuxt-openfga/`, which Docus only partly supports:
the workflow passes the base path and site URL, `docs/nuxt.config.ts` gives
`nuxt-agent-discovery` the bare origin it requires and turns off the MCP
server and `robots.txt`, and the favicon path names the base path. A custom
domain would remove those workarounds. The theme's dependencies are
`devDependencies` of `docs/`, a separate pnpm project; none of them runs in the
published static site.
