import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e'

// Builds an app that gets the module only through a Nuxt layer (the
// playground), and checks that everything the layer sets up reaches the
// extending app: merged options, the check route, server auto-imports, the
// layer's auth middleware, and <Can>/useCan on the app's own pages.
describe('module installed by a Nuxt layer', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/layer-app', import.meta.url)),
    server: true,
    browser: false,
  })

  const as = (user: string) => ({ headers: { cookie: `demo-user=${user}` } })

  it('merges options: the app overrides the layer, the layer overrides the defaults', async () => {
    expect(await $fetch('/api/layer-probe/config')).toEqual({
      userIdPath: 'auth.userId', // set by the layer
      contextualTuplesKey: 'roleTuples', // set by the layer
      cacheTtlMs: 5_000, // set by the app, overriding the default
      cacheMaxEntries: 10_000, // module default
    })
  })

  it('serves the check route, with the subject from the layer\'s middleware', async () => {
    const check = (user: string, objectId: string) =>
      $fetch('/api/_authz/check', {
        method: 'POST',
        headers: { cookie: `demo-user=${user}` },
        body: { relation: 'viewer', objectType: 'document', objectId },
      })
    expect(await check('alice', 'roadmap')).toEqual({ allowed: true })
    expect(await check('carol', 'handbook')).toEqual({ allowed: true }) // contextual tuple
    expect(await check('dave', 'roadmap')).toEqual({ allowed: false })
  })

  it('enforces requireRelation in a route the app defines', async () => {
    expect(await $fetch('/api/layer-probe/roadmap', as('alice'))).toEqual({ id: 'roadmap' })
    expect((await fetch('/api/layer-probe/roadmap', as('dave'))).status).toBe(403)
    expect((await fetch('/api/layer-probe/roadmap')).status).toBe(401)
  })

  it('renders <Can> and useCan on the app\'s own page', async () => {
    const bob = await $fetch<string>('/app-page', as('bob'))
    expect(bob).toContain('data-testid="usecan-denied"')
    expect(bob).toContain('data-testid="can-allowed"')

    const alice = await $fetch<string>('/app-page', as('alice'))
    expect(alice).toContain('data-testid="usecan-allowed"')
    expect(alice).toContain('data-testid="can-denied"')
  })

  it('still serves the layer\'s own pages', async () => {
    const html = await $fetch<string>('/', as('alice'))
    expect(html).toContain('data-testid="allowed-roadmap"')
    expect(html).toContain('data-testid="denied-handbook"')
  })
})
