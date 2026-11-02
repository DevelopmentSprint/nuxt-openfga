export default defineAppConfig({
  seo: {
    title: 'nuxt-openfga',
    description: 'OpenFGA authorization for Nuxt: cached server helpers, route guards, a <Can> component, and an in-memory evaluator for tests.',
  },
  header: {
    title: 'nuxt-openfga',
    logo: {
      // Docus uses this path as is, without app.baseURL, so it names the
      // GitHub Pages path. In local dev the favicon does not load.
      favicon: '/nuxt-openfga/favicon.svg',
    },
  },
  github: {
    url: 'https://github.com/DevelopmentSprint/nuxt-openfga',
    // Edit links point at the integration branch, where changes are made.
    branch: 'develop',
    rootDir: 'docs',
  },
  socials: {
    github: 'https://github.com/DevelopmentSprint/nuxt-openfga',
    npm: 'https://www.npmjs.com/package/@developmentsprint/nuxt-openfga',
  },
  ui: {
    colors: {
      primary: 'sky',
      neutral: 'slate',
    },
  },
})
