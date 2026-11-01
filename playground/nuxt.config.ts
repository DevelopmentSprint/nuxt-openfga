// Runs the module in memory mode, so it needs no OpenFGA server. The model and
// tuples are loaded by server/plugins/memory-store.ts.
export default defineNuxtConfig({
  modules: ['../src/module'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  openfga: {
    autoDeployModel: false,
    userIdPath: 'auth.userId',
    contextualTuplesKey: 'roleTuples',
  },
})
