# nuxt-openfga documentation

The documentation site, built with [Docus](https://docus.dev) and published to
GitHub Pages by `.github/workflows/docs.yml`. It is a separate pnpm project with
its own lockfile; nothing here ships in the npm package.

```bash
cd docs
pnpm install
pnpm dev        # http://localhost:3000
pnpm generate   # static site in .output/public
```

Pages live in `content/`. The numeric prefixes order the sidebar and do not
appear in URLs.
