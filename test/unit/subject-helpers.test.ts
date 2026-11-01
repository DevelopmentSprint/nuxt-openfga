import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkAccess,
  checkAccessForSubject,
  writeRelationship,
  writeRelationshipForSubject,
  deleteRelationship,
  deleteRelationshipForSubject,
  listObjects,
  listObjectsForSubject,
  clearAuthzCache,
  resetOpenFGAClient,
} from '../../src/runtime/server/utils/openfga'

const mockWrite = vi.fn().mockResolvedValue({})
const mockCheck = vi.fn().mockResolvedValue({ allowed: true })
const mockListObjects = vi.fn().mockResolvedValue({ objects: ['tool:ci', 'tool:docs'] })

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

describe('Subject-aware OpenFGA helpers', () => {
  beforeEach(() => {
    clearAuthzCache()
    resetOpenFGAClient()
    mockWrite.mockClear()
    mockCheck.mockClear()
    mockListObjects.mockClear()
  })

  describe('checkAccessForSubject', () => {
    it('passes the subject through verbatim — no "user:" prefix injected', async () => {
      await checkAccessForSubject('team:platform-eng', 'can_invoke', 'tool', 'ci')

      expect(mockCheck).toHaveBeenCalledWith({
        user: 'team:platform-eng',
        relation: 'can_invoke',
        object: 'tool:ci',
      })
    })

    it('handles userset subjects (type:id#relation form)', async () => {
      await checkAccessForSubject('group:g-1#member', 'viewer', 'project', 'proj-1')

      expect(mockCheck).toHaveBeenCalledWith({
        user: 'group:g-1#member',
        relation: 'viewer',
        object: 'project:proj-1',
      })
    })

    it('still works for plain user subjects when caller passes the full form', async () => {
      await checkAccessForSubject('user:abc-123', 'can_view', 'project', 'proj-1')

      expect(mockCheck).toHaveBeenCalledWith({
        user: 'user:abc-123',
        relation: 'can_view',
        object: 'project:proj-1',
      })
    })
  })

  describe('listObjectsForSubject', () => {
    it('passes the subject through verbatim', async () => {
      const result = await listObjectsForSubject('team:platform-eng', 'can_invoke', 'tool')

      expect(mockListObjects).toHaveBeenCalledWith({
        user: 'team:platform-eng',
        relation: 'can_invoke',
        type: 'tool',
      })
      expect(result).toEqual(['tool:ci', 'tool:docs'])
    })
  })

  describe('writeRelationshipForSubject', () => {
    it('writes a tuple with the subject verbatim', async () => {
      await writeRelationshipForSubject('group:g-1#member', 'viewer', 'project', 'proj-1')

      expect(mockWrite).toHaveBeenCalledWith({
        writes: [
          {
            user: 'group:g-1#member',
            relation: 'viewer',
            object: 'project:proj-1',
          },
        ],
      })
    })
  })

  describe('deleteRelationshipForSubject', () => {
    it('deletes a tuple with the subject verbatim', async () => {
      await deleteRelationshipForSubject('team:platform-eng', 'can_invoke', 'tool', 'ci')

      expect(mockWrite).toHaveBeenCalledWith({
        deletes: [
          {
            user: 'team:platform-eng',
            relation: 'can_invoke',
            object: 'tool:ci',
          },
        ],
      })
    })
  })

  describe('back-compat: existing user-form helpers still prepend "user:"', () => {
    it('checkAccess still calls SDK with "user:" prefix', async () => {
      await checkAccess('abc', 'can_view', 'project', 'proj')
      expect(mockCheck).toHaveBeenCalledWith({
        user: 'user:abc',
        relation: 'can_view',
        object: 'project:proj',
      })
    })

    it('writeRelationship still calls SDK with "user:" prefix', async () => {
      await writeRelationship('abc', 'editor', 'project', 'proj')
      expect(mockWrite).toHaveBeenCalledWith({
        writes: [{ user: 'user:abc', relation: 'editor', object: 'project:proj' }],
      })
    })

    it('deleteRelationship still calls SDK with "user:" prefix', async () => {
      await deleteRelationship('abc', 'editor', 'project', 'proj')
      expect(mockWrite).toHaveBeenCalledWith({
        deletes: [{ user: 'user:abc', relation: 'editor', object: 'project:proj' }],
      })
    })

    it('listObjects still calls SDK with "user:" prefix', async () => {
      await listObjects('abc', 'can_view', 'project')
      expect(mockListObjects).toHaveBeenCalledWith({
        user: 'user:abc',
        relation: 'can_view',
        type: 'project',
      })
    })
  })
})
