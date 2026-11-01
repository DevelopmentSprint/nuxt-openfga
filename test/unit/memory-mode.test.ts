import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkAccess,
  checkAccessForSubject,
  listObjectsForSubject,
  writeRelationshipForSubject,
  deleteRelationshipForSubject,
  resetOpenFGAClient,
  clearAuthzCache,
} from '../../src/runtime/server/utils/openfga'
import {
  loadMemoryStore,
  resetMemoryStore,
} from '../../src/runtime/server/utils/memory-store'
import type {
  AuthorizationModel,
  MemoryTuple,
} from '../../src/runtime/server/utils/memory-evaluator'

// vitest hoists vi.mock above imports at runtime; lint requires imports first.
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    openfga: {
      apiUrl: '',
      storeId: '',
      modelId: '',
      cacheMaxEntries: 10_000,
      cacheTtlMs: 30_000,
    },
  }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
  defineEventHandler: (handler: unknown) => handler,
}))

const MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'team',
      relations: {
        descendant: { this: {} },
        member: { this: {} },
        member_or_higher: {
          union: {
            child: [
              { computedUserset: { relation: 'member' } },
              {
                tupleToUserset: {
                  tupleset: { relation: 'descendant' },
                  computedUserset: { relation: 'member_or_higher' },
                },
              },
            ],
          },
        },
      },
    },
    {
      type: 'tool',
      relations: {
        grants_to: { this: {} },
        can_invoke: { computedUserset: { relation: 'grants_to' } },
      },
    },
  ],
}

const TUPLES: MemoryTuple[] = [
  { user: 'user:alice', relation: 'member', object: 'team:platform-eng' },
  { user: 'team:platform-eng', relation: 'descendant', object: 'team:backend' },
  { user: 'team:platform-eng', relation: 'descendant', object: 'team:frontend' },
  { user: 'team:platform-eng#member_or_higher', relation: 'grants_to', object: 'tool:ci' },
  { user: 'team:backend#member_or_higher', relation: 'grants_to', object: 'tool:deploy' },
]

describe('OpenFGA memory mode', () => {
  beforeEach(() => {
    process.env['OPENFGA_MODE'] = 'memory'
    resetOpenFGAClient()
    clearAuthzCache()
    loadMemoryStore({ model: MODEL, tuples: TUPLES })
  })

  afterEach(() => {
    delete process.env['OPENFGA_MODE']
    resetMemoryStore()
    resetOpenFGAClient()
    clearAuthzCache()
  })

  describe('check', () => {
    it('resolves direct membership', async () => {
      expect(await checkAccess('alice', 'member', 'team', 'platform-eng')).toBe(true)
    })

    it('resolves recursive descendant via tupleToUserset', async () => {
      expect(await checkAccessForSubject('user:alice', 'member_or_higher', 'team', 'backend')).toBe(true)
      expect(await checkAccessForSubject('user:alice', 'member_or_higher', 'team', 'frontend')).toBe(true)
    })

    it('denies access for unrelated subjects', async () => {
      expect(await checkAccess('bob', 'member', 'team', 'platform-eng')).toBe(false)
    })
  })

  describe('listObjects', () => {
    it('enumerates tools accessible at a team via userset tuple + computed relation', async () => {
      const tools = await listObjectsForSubject('user:alice', 'can_invoke', 'tool')
      expect(tools.sort()).toEqual(['tool:ci', 'tool:deploy'])
    })

    it('returns empty for a subject with no grants', async () => {
      const tools = await listObjectsForSubject('user:bob', 'can_invoke', 'tool')
      expect(tools).toEqual([])
    })
  })

  describe('write / delete', () => {
    it('write adds a tuple visible to subsequent checks', async () => {
      // alice initially has no direct grant on tool:slack
      expect(await checkAccessForSubject('user:alice', 'grants_to', 'tool', 'slack')).toBe(false)

      await writeRelationshipForSubject('user:alice', 'grants_to', 'tool', 'slack')

      expect(await checkAccessForSubject('user:alice', 'grants_to', 'tool', 'slack')).toBe(true)
    })

    it('delete removes a tuple', async () => {
      await writeRelationshipForSubject('user:alice', 'grants_to', 'tool', 'temp')
      expect(await checkAccessForSubject('user:alice', 'grants_to', 'tool', 'temp')).toBe(true)

      await deleteRelationshipForSubject('user:alice', 'grants_to', 'tool', 'temp')

      expect(await checkAccessForSubject('user:alice', 'grants_to', 'tool', 'temp')).toBe(false)
    })

    it('rejects a duplicate write, as OpenFGA does', async () => {
      await writeRelationshipForSubject('user:alice', 'grants_to', 'tool', 'idem')
      await expect(writeRelationshipForSubject('user:alice', 'grants_to', 'tool', 'idem')).rejects.toThrow(/already exists/)
      await deleteRelationshipForSubject('user:alice', 'grants_to', 'tool', 'idem')
      expect(await checkAccessForSubject('user:alice', 'grants_to', 'tool', 'idem')).toBe(false)
    })
  })

  describe('store lifecycle', () => {
    it('throws when memory mode is on but store is not loaded', async () => {
      resetMemoryStore()
      resetOpenFGAClient()
      clearAuthzCache()
      await expect(checkAccess('alice', 'member', 'team', 'platform-eng')).rejects.toThrow(/loadMemoryStore/)
    })
  })

  describe('mode isolation', () => {
    it('resetting OPENFGA_MODE returns to server-mode behavior on next client construction', async () => {
      // In server mode (no env), the client construction would require OPENFGA_API_URL.
      // We don't call useOpenFGAClient() here — the test below validates that the dispatch
      // is gated by isMemoryMode() at construction time, not at every call.
      resetOpenFGAClient()
      delete process.env['OPENFGA_MODE']
      // Local .env may set OPENFGA_API_URL; clear it so the assertion isn't shadowed by ambient env.
      const savedApiUrl = process.env['OPENFGA_API_URL']
      delete process.env['OPENFGA_API_URL']
      try {
        await expect(checkAccess('alice', 'member', 'team', 'platform-eng')).rejects.toThrow(/API URL not configured/)
      }
      finally {
        if (savedApiUrl !== undefined) {
          process.env['OPENFGA_API_URL'] = savedApiUrl
        }
      }
    })
  })
})
