# Changesets

This directory tracks release notes and semver bumps.

## Create a changeset

```bash
pnpm changeset
```

## Apply versioning changes locally

```bash
pnpm version-packages
```

## Publish (CI)

Publishing is handled by `npm-publish.yml` when a maintainer publishes a stable GitHub release. Changesets only prepares version PRs. See `REPOSITORY_SETUP.md` for trusted publisher configuration.
