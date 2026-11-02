// The site is generated statically and served by GitHub Pages under
// https://developmentsprint.github.io/nuxt-openfga/. The deploy workflow sets
// NUXT_APP_BASE_URL=/nuxt-openfga/ and NUXT_SITE_URL to that address; local
// dev serves from /.
export default defineNuxtConfig({
  extends: ['docus'],
  site: {
    name: 'nuxt-openfga',
  },
  // nuxt-agent-discovery accepts only an origin, not a URL with a path.
  agentDiscovery: {
    siteUrl: 'https://developmentsprint.github.io',
  },
  // Needs a server; GitHub Pages is static.
  mcp: false,
  nitro: {
    preset: 'github_pages',
    prerender: {
      // GitHub Pages serves a folder's index.html for /path, but not
      // path.html when a path/ folder exists beside it. Docus turns this off.
      autoSubfolderIndex: true,
      // Docus tolerates pages that fail to prerender; a broken page or link
      // fails the build here instead.
      failOnError: true,
    },
  },
  robots: {
    // Crawlers only read robots.txt at the domain root, which this site is not.
    robotsTxt: false,
  },
})
