import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkAccessForSubject,
  deleteRelationshipForSubject,
  writeRelationshipForSubject,
  invalidateCacheForSubject,
  clearAuthzCache,
  resetOpenFGAClient,
  _testing,
} from '../../src/runtime/server/utils/openfga'

const mockCheck = vi.fn()
const mockWrite = vi.fn().mockResolvedValue({})

vi.mock('@openfga/sdk', () => ({
  OpenFgaClient: vi.fn(function (this: unknown) {
    Object.assign(this as object, { check: mockCheck, write: mockWrite, listObjects: vi.fn() })
  }),
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    openfga: { apiUrl: 'http://openfga.test', cacheMaxEntries: 2, cacheTtlMs: 30_000 },
  }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
}))

const ADMIN_FACT = [{ user: 'user:alice', relation: 'admin', object: 'org:acme' }]

describe('cache invalidation', () => {
  beforeEach(() => {
    clearAuthzCache()
    resetOpenFGAClient()
    mockCheck.mockReset()
    mockWrite.mockClear()
  })

  it('drops checks made with contextual tuples when the relationship is deleted', async () => {
    mockCheck.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false })

    expect(await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1', { contextualTuples: ADMIN_FACT })).toBe(true)
    await deleteRelationshipForSubject('user:alice', 'viewer', 'document', 'd1')

    // A stale cache hit would return true without asking the server again.
    expect(await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1', { contextualTuples: ADMIN_FACT })).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('drops checks made with contextual tuples when a relationship is written', async () => {
    mockCheck.mockResolvedValueOnce({ allowed: false }).mockResolvedValueOnce({ allowed: true })

    await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1', { contextualTuples: ADMIN_FACT })
    await writeRelationshipForSubject('user:alice', 'viewer', 'document', 'd1')

    expect(await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1', { contextualTuples: ADMIN_FACT })).toBe(true)
  })

  it('leaves other subjects and objects cached', async () => {
    mockCheck.mockResolvedValue({ allowed: true })
    await checkAccessForSubject('user:bob', 'viewer', 'document', 'd1')
    await checkAccessForSubject('user:alice', 'viewer', 'document', 'd2')

    invalidateCacheForSubject('user:alice', 'document', 'd1')

    expect(_testing._cache.size).toBe(2)
  })

  it('does not treat a subject whose id extends another as the same subject', async () => {
    mockCheck.mockResolvedValue({ allowed: true })
    await checkAccessForSubject('user:al', 'viewer', 'document', 'd1')

    invalidateCacheForSubject('user:a', 'document', 'd1')

    expect(_testing._cache.size).toBe(1)
  })
})

describe('cache eviction', () => {
  beforeEach(() => clearAuthzCache())

  it('evicts the least recently used entry, not the oldest inserted', () => {
    const { cacheGet, cacheSet, cacheKey } = _testing
    const a = cacheKey('user:a', 'viewer', 'document', '1')
    const b = cacheKey('user:b', 'viewer', 'document', '1')
    const c = cacheKey('user:c', 'viewer', 'document', '1')

    cacheSet(a, true)
    cacheSet(b, true)
    cacheGet(a) // touch a, so b is now least recently used
    cacheSet(c, true)

    expect(cacheGet(a)).toBe(true)
    expect(cacheGet(b)).toBeUndefined()
    expect(cacheGet(c)).toBe(true)
  })
})

describe('cache disabled', () => {
  it('stores nothing when cacheMaxEntries is 0', async () => {
    vi.resetModules()
    vi.doMock('#imports', () => ({
      useRuntimeConfig: () => ({ openfga: { apiUrl: 'http://openfga.test', cacheMaxEntries: 0, cacheTtlMs: 30_000 } }),
      createError: (e: Record<string, unknown>) => Object.assign(new Error(String(e.message)), e),
    }))
    const mod = await import('../../src/runtime/server/utils/openfga')
    mod._testing.cacheSet('k', true)
    expect(mod._testing._cache.size).toBe(0)
    expect(mod._testing.cacheGet('k')).toBeUndefined()
    vi.doUnmock('#imports')
  })
})

describe('review regressions', () => {
  beforeEach(() => {
    clearAuthzCache()
    resetOpenFGAClient()
    mockCheck.mockReset()
  })

  it('a write or delete on an object clears cached decisions for every subject on it', async () => {
    // alice's allow came through a wildcard tuple; deleting that tuple must clear it.
    mockCheck.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false })
    await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1')
    await deleteRelationshipForSubject('user:*', 'viewer', 'document', 'd1')
    expect(await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1')).toBe(false)
  })

  it('does not cache a decision that was in flight across an invalidation', async () => {
    let release!: (v: { allowed: boolean }) => void
    mockCheck.mockImplementationOnce(() => new Promise(r => (release = r)))
    mockCheck.mockResolvedValueOnce({ allowed: false })

    const inFlight = checkAccessForSubject('user:alice', 'viewer', 'document', 'd1')
    await deleteRelationshipForSubject('user:alice', 'viewer', 'document', 'd1')
    release({ allowed: true })
    expect(await inFlight).toBe(true) // the caller still gets the answer it asked for

    expect(await checkAccessForSubject('user:alice', 'viewer', 'document', 'd1')).toBe(false)
    expect(mockCheck).toHaveBeenCalledTimes(2)
  })

  it('never lets two different questions share a cache key', () => {
    const { cacheKey } = _testing
    expect(cacheKey('user:a:b', 'c', 'd', 'e')).not.toBe(cacheKey('user:a', 'b', 'c', 'd:e'))
    expect(cacheKey('user:a', 'r', 't', 'x|ctx:user:a|admin|org:1'))
      .not.toBe(cacheKey('user:a', 'r', 't', 'x', [{ user: 'user:a', relation: 'admin', object: 'org:1' }]))
  })
})
