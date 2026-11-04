import { fileURLToPath } from 'node:url'

// Runs the module in memory mode, so it needs no OpenFGA server. The model and
// tuples are loaded by server/plugins/memory-store.ts.
// test/fixtures/layer-app also uses this directory as a Nuxt layer. Nuxt
// resolves a relative module path in a layer from the extending app's
// directory, so the module path is absolute.
export default defineNuxtConfig({
  modules: [fileURLToPath(new URL('../src/module', import.meta.url))],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  openfga: {
    userIdPath: 'auth.userId',
    contextualTuplesKey: 'roleTuples',
  },
})
