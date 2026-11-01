import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkAccess,
  writeRelationship,
  deleteRelationship,
  listObjects,
  clearAuthzCache,
  resetOpenFGAClient,
} from '../../src/runtime/server/utils/openfga'

/**
 * Tests for relationship tuple formatting.
 * Verifies that the OpenFGA helpers produce correctly formatted tuples
 * when calling the OpenFGA SDK.
 */

const mockWrite = vi.fn().mockResolvedValue({})
const mockCheck = vi.fn().mockResolvedValue({ allowed: true })
const mockListObjects = vi.fn().mockResolvedValue({ objects: ['project:proj-1', 'project:proj-2'] })

vi.mock('@openfga/sdk', () => ({
  OpenFgaClient: vi.fn(function (this: unknown) {
    Object.assign(this as object, { write: mockWrite, check: mockCheck, listObjects: mockListObjects })
  }),
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    openfga: {
      apiUrl: 'http://openfga.test',
      storeId: 'store-id',
      modelId: 'model-id',
      cacheMaxEntries: 10_000,
      cacheTtlMs: 30_000,
    },
  }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
  defineEventHandler: (handler: unknown) => handler,
}))

describe('Relationship Tuple Formatting', () => {
  beforeEach(() => {
    clearAuthzCache()
    resetOpenFGAClient()
    mockWrite.mockClear()
    mockCheck.mockClear()
    mockListObjects.mockClear()
  })

  describe('checkAccess', () => {
    it('formats user as "user:{userId}"', async () => {
      await checkAccess('abc-123', 'can_view', 'project', 'proj-456')

      expect(mockCheck).toHaveBeenCalledWith({
        user: 'user:abc-123',
        relation: 'can_view',
        object: 'project:proj-456',
      })
    })

    it('formats object as "{objectType}:{objectId}"', async () => {
      await checkAccess('user-1', 'can_post', 'community_room', 'room-789')

      expect(mockCheck).toHaveBeenCalledWith({
        user: 'user:user-1',
        relation: 'can_post',
        object: 'community_room:room-789',
      })
    })
  })

  describe('writeRelationship', () => {
    it('formats write tuple correctly', async () => {
      await writeRelationship('user-1', 'editor', 'project', 'proj-1')

      expect(mockWrite).toHaveBeenCalledWith({
        writes: [
          {
            user: 'user:user-1',
            relation: 'editor',
            object: 'project:proj-1',
          },
        ],
      })
    })
  })

  describe('deleteRelationship', () => {
    it('formats delete tuple correctly', async () => {
      await deleteRelationship('user-1', 'cpa', 'project', 'proj-1')

      expect(mockWrite).toHaveBeenCalledWith({
        deletes: [
          {
            user: 'user:user-1',
            relation: 'cpa',
            object: 'project:proj-1',
          },
        ],
      })
    })
  })

  describe('listObjects', () => {
    it('formats the request correctly', async () => {
      await listObjects('user-1', 'can_view', 'project')

      expect(mockListObjects).toHaveBeenCalledWith({
        user: 'user:user-1',
        relation: 'can_view',
        type: 'project',
      })
    })

    it('returns the object identifiers exactly as OpenFGA returns them', async () => {
      const result = await listObjects('user-1', 'can_view', 'project')
      expect(result).toEqual(['project:proj-1', 'project:proj-2'])
    })

    it('propagates SDK errors', async () => {
      mockListObjects.mockRejectedValueOnce(new Error('Network error'))
      await expect(listObjects('user-1', 'can_view', 'project')).rejects.toThrow('Network error')
    })
  })
})
