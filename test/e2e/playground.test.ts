import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e'

// Builds the playground (memory mode, no OpenFGA server) and exercises the
// module through real HTTP: route registration, Nitro auto-imports, the
// configurable context paths, contextual tuples and <Can> during SSR.
describe('playground', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../../playground', import.meta.url)),
    server: true,
    browser: false,
  })

  const as = (user: string) => ({ headers: { cookie: `demo-user=${user}` } })
  const check = (user: string | undefined, objectId: string) =>
    fetch('/api/_authz/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(user ? { cookie: `demo-user=${user}` } : {}) },
      body: JSON.stringify({ relation: 'viewer', objectType: 'document', objectId }),
    })

  describe('POST /api/_authz/check', () => {
    it.each([
      ['alice', 'roadmap', true], // direct owner
      ['alice', 'handbook', false],
      ['bob', 'handbook', true], // member of the owning org (tupleToUserset)
      ['bob', 'roadmap', false],
      ['carol', 'handbook', true], // org admin through a contextual tuple only
      ['dave', 'handbook', false],
    ])('%s viewing %s → %s', async (user, doc, expected) => {
      const res = await check(user, doc)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ allowed: expected })
    })

    it('rejects anonymous requests', async () => {
      expect((await check(undefined, 'roadmap')).status).toBe(401)
    })

    it('rejects malformed bodies', async () => {
      const res = await fetch('/api/_authz/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'demo-user=alice' },
        body: JSON.stringify({ relation: 'viewer' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('requireRelation', () => {
    it('lets an allowed user through', async () => {
      expect(await $fetch('/api/documents/roadmap', as('alice'))).toEqual({ id: 'roadmap' })
    })

    it('honors contextual tuples passed with getAuthzContextualTuples', async () => {
      expect(await $fetch('/api/documents/handbook', as('carol'))).toEqual({ id: 'handbook' })
    })

    it('returns 403 for a denied user and 401 when anonymous', async () => {
      expect((await fetch('/api/documents/roadmap', as('dave'))).status).toBe(403)
      expect((await fetch('/api/documents/roadmap')).status).toBe(401)
    })
  })

  describe('<Can> server rendering', () => {
    it('renders each fenced block from its own check', async () => {
      const html = await $fetch<string>('/', as('alice'))
      expect(html).toContain('data-testid="allowed-roadmap"')
      expect(html).toContain('data-testid="denied-handbook"')
      expect(html).not.toContain('data-testid="allowed-handbook"')
    })

    it('renders the fallback for anonymous visitors', async () => {
      const html = await $fetch<string>('/')
      expect(html).toContain('data-testid="denied-roadmap"')
      expect(html).toContain('data-testid="denied-handbook"')
    })
  })
})
