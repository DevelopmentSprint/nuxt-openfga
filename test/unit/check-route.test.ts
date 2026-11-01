import type { H3Event } from 'h3'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runtimeOpenfga: Record<string, unknown> = {}
const mockCheck = vi.fn()
let requestBody: unknown

vi.mock('@openfga/sdk', () => ({
  OpenFgaClient: vi.fn(function (this: unknown) {
    Object.assign(this as object, { check: mockCheck, write: vi.fn(), listObjects: vi.fn() })
  }),
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ openfga: { apiUrl: 'http://openfga.test', ...runtimeOpenfga } }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? error.statusMessage)), error),
}))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readBody: async () => requestBody,
    createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.statusMessage)), error),
  }
})

const { default: handler } = await import('../../src/runtime/server/routes/check.post')
const { clearAuthzCache, resetOpenFGAClient } = await import('../../src/runtime/server/utils/openfga')
const call = handler as unknown as (event: H3Event) => Promise<{ allowed: boolean }>
const event = (context: Record<string, unknown>) => ({ context }) as unknown as H3Event

const VALID = { relation: 'can_view', objectType: 'document', objectId: 'd1' }

beforeEach(() => {
  Object.keys(runtimeOpenfga).forEach(k => Reflect.deleteProperty(runtimeOpenfga, k))
  mockCheck.mockReset()
  clearAuthzCache()
  resetOpenFGAClient()
  requestBody = VALID
})

describe('POST /api/_authz/check', () => {
  it('checks the session user and returns the decision', async () => {
    mockCheck.mockResolvedValue({ allowed: true })
    await expect(call(event({ user: { id: 'alice' } }))).resolves.toEqual({ allowed: true })
    expect(mockCheck).toHaveBeenCalledWith({ user: 'user:alice', relation: 'can_view', object: 'document:d1' })
  })

  it('ignores a subject supplied in the body', async () => {
    mockCheck.mockResolvedValue({ allowed: false })
    requestBody = { ...VALID, user: 'user:admin', userId: 'admin' }
    await call(event({ user: { id: 'alice' } }))
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ user: 'user:alice' }))
  })

  it('responds 401 without a session user', async () => {
    await expect(call(event({}))).rejects.toMatchObject({ statusCode: 401 })
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('responds 400 naming each invalid field', async () => {
    requestBody = { relation: 'can_view', objectType: '', objectId: 7 }
    await expect(call(event({ user: { id: 'alice' } }))).rejects.toMatchObject({
      statusCode: 400,
      data: { invalidFields: ['objectType', 'objectId'] },
    })
  })

  it('responds 400 for a missing body', async () => {
    requestBody = undefined
    await expect(call(event({ user: { id: 'alice' } }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('includes contextual tuples from the configured key', async () => {
    runtimeOpenfga['contextualTuplesKey'] = 'roleTuples'
    const tuples = [{ user: 'user:alice', relation: 'admin', object: 'org:acme' }]
    mockCheck.mockResolvedValue({ allowed: true })
    await call(event({ user: { id: 'alice' }, roleTuples: tuples }))
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ contextualTuples: tuples }))
  })
})
