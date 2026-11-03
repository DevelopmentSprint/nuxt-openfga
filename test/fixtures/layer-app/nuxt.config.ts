// An app that gets nuxt-openfga only through a layer: the playground installs
// the module, sets its options and supplies the auth middleware and store.
// This app overrides one option and adds its own guarded route and page.
export default defineNuxtConfig({
  extends: ['../../../playground'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  openfga: {
    cacheTtlMs: 5_000,
  },
})
