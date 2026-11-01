import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  clearAuthzCache,
  getAuthzCacheStats,
  resetOpenFGAClient,
  _testing,
} from '../../src/runtime/server/utils/openfga'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    openfga: {
      apiUrl: 'http://openfga.test',
      cacheMaxEntries: 10_000,
      cacheTtlMs: 30_000,
    },
  }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
  defineEventHandler: (handler: unknown) => handler,
}))

const { cacheGet, cacheSet, cacheKey, cacheInvalidateForObject, CACHE_TTL_MS, CACHE_MAX_SIZE, _cache } = _testing

describe('OpenFGA Authorization Cache', () => {
  beforeEach(() => {
    clearAuthzCache()
    resetOpenFGAClient()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cacheKey', () => {
    it('generates a deterministic key from components', () => {
      const key = cacheKey('user-1', 'can_view', 'project', 'proj-1')
      expect(key).toBe('["user-1","can_view","project","proj-1"]')
    })

    it('produces different keys for different inputs', () => {
      const key1 = cacheKey('user-1', 'can_view', 'project', 'proj-1')
      const key2 = cacheKey('user-2', 'can_view', 'project', 'proj-1')
      expect(key1).not.toBe(key2)
    })

    it('matches the contextual-tuple-free key when contextual tuples are absent or empty', () => {
      const base = cacheKey('user-1', 'admin', 'org', 'acme')
      expect(cacheKey('user-1', 'admin', 'org', 'acme', [])).toBe(base)
      expect(cacheKey('user-1', 'admin', 'org', 'acme', undefined)).toBe(base)
    })

    it('produces a different key when contextual tuples differ', () => {
      const base = cacheKey('user-1', 'admin', 'org', 'acme')
      const withTuples = cacheKey('user-1', 'admin', 'org', 'acme', [
        { user: 'user:1', relation: 'admin', object: 'org:acme' },
      ])
      expect(withTuples).not.toBe(base)
    })

    it('is invariant under contextual-tuple input ordering', () => {
      const a = cacheKey('user-1', 'admin', 'org', 'acme', [
        { user: 'user:1', relation: 'member', object: 'org:acme' },
        { user: 'user:1', relation: 'admin',  object: 'org:acme' },
      ])
      const b = cacheKey('user-1', 'admin', 'org', 'acme', [
        { user: 'user:1', relation: 'admin',  object: 'org:acme' },
        { user: 'user:1', relation: 'member', object: 'org:acme' },
      ])
      expect(a).toBe(b)
    })
  })

  describe('cacheGet / cacheSet', () => {
    it('returns undefined for a cache miss', () => {
      expect(cacheGet('nonexistent-key')).toBeUndefined()
    })

    it('returns the cached value on a cache hit', () => {
      cacheSet('test-key', true)
      expect(cacheGet('test-key')).toBe(true)
    })

    it('caches false values correctly', () => {
      cacheSet('deny-key', false)
      expect(cacheGet('deny-key')).toBe(false)
    })

    it('returns undefined after TTL expires', () => {
      cacheSet('expiring-key', true)
      expect(cacheGet('expiring-key')).toBe(true)

      // Advance time past TTL
      vi.advanceTimersByTime(CACHE_TTL_MS + 1)
      expect(cacheGet('expiring-key')).toBeUndefined()
    })

    it('returns value just before TTL expires', () => {
      cacheSet('edge-key', true)
      vi.advanceTimersByTime(CACHE_TTL_MS - 1)
      expect(cacheGet('edge-key')).toBe(true)
    })
  })

  describe('cache eviction', () => {
    it('evicts oldest entry when cache exceeds max size', () => {
      // Fill cache to capacity
      for (let i = 0; i < CACHE_MAX_SIZE; i++) {
        cacheSet(`key-${i}`, true)
      }
      expect(_cache.size).toBe(CACHE_MAX_SIZE)

      // Add one more entry
      cacheSet('overflow-key', true)
      expect(_cache.size).toBe(CACHE_MAX_SIZE)

      // First entry should have been evicted
      expect(cacheGet('key-0')).toBeUndefined()

      // New entry should exist
      expect(cacheGet('overflow-key')).toBe(true)
    })
  })

  describe('cacheInvalidateForObject', () => {
    it('removes all cache entries for a specific object', () => {
      cacheSet('user-1:can_view:project:proj-1', true, { subject: 'user-1', objectType: 'project', objectId: 'proj-1' })
      cacheSet('user-2:can_view:project:proj-1', true, { subject: 'user-2', objectType: 'project', objectId: 'proj-1' })
      cacheSet('user-1:can_view:project:proj-2', true, { subject: 'user-1', objectType: 'project', objectId: 'proj-2' })

      cacheInvalidateForObject('project', 'proj-1')

      // Entries for proj-1 should be gone
      expect(cacheGet('user-1:can_view:project:proj-1')).toBeUndefined()
      expect(cacheGet('user-2:can_view:project:proj-1')).toBeUndefined()

      // Entry for proj-2 should still exist
      expect(cacheGet('user-1:can_view:project:proj-2')).toBe(true)
    })
  })

  describe('clearAuthzCache', () => {
    it('removes all entries', () => {
      cacheSet('key-1', true)
      cacheSet('key-2', false)
      expect(getAuthzCacheStats().size).toBe(2)

      clearAuthzCache()
      expect(getAuthzCacheStats().size).toBe(0)
    })
  })

  describe('getAuthzCacheStats', () => {
    it('reports correct stats', () => {
      cacheSet('stat-key', true)
      const stats = getAuthzCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.maxEntries).toBe(CACHE_MAX_SIZE)
      expect(stats.ttlMs).toBe(CACHE_TTL_MS)
    })
  })
})
