import type { H3Event } from 'h3'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runtimeOpenfga: Record<string, unknown> = {}
const mockCheck = vi.fn()

vi.mock('@openfga/sdk', () => ({
  OpenFgaClient: vi.fn(function (this: unknown) {
    Object.assign(this as object, { check: mockCheck, write: vi.fn(), listObjects: vi.fn() })
  }),
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ openfga: { apiUrl: 'http://openfga.test', ...runtimeOpenfga } }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? error.statusMessage)), error),
}))

const { getAuthzUserId, getAuthzContextualTuples } = await import('../../src/runtime/server/utils/event-context')
const { requireRelation, clearAuthzCache, resetOpenFGAClient } = await import('../../src/runtime/server/utils/openfga')

function fakeEvent(context: Record<string, unknown>): H3Event {
  return { context } as unknown as H3Event
}

const TUPLES = [{ user: 'user:alice', relation: 'admin', object: 'org:acme' }]

beforeEach(() => {
  Object.keys(runtimeOpenfga).forEach(k => Reflect.deleteProperty(runtimeOpenfga, k))
  mockCheck.mockReset()
  clearAuthzCache()
  resetOpenFGAClient()
})

describe('getAuthzUserId', () => {
  it('reads event.context.user.id by default', () => {
    expect(getAuthzUserId(fakeEvent({ user: { id: 'alice' } }))).toBe('alice')
  })

  it('follows a configured dot path', () => {
    runtimeOpenfga['userIdPath'] = 'auth.session.sub'
    expect(getAuthzUserId(fakeEvent({ auth: { session: { sub: 'u-9' } } }))).toBe('u-9')
  })

  it('stringifies numeric ids', () => {
    expect(getAuthzUserId(fakeEvent({ user: { id: 42 } }))).toBe('42')
  })

  it.each([
    ['no user', {}],
    ['user without id', { user: {} }],
    ['empty id', { user: { id: '' } }],
    ['object id', { user: { id: { nested: true } } }],
    ['path through a primitive', { user: 'alice' }],
  ])('treats %s as anonymous', (_name, context) => {
    expect(getAuthzUserId(fakeEvent(context))).toBeUndefined()
  })
})

describe('getAuthzContextualTuples', () => {
  it('reads event.context.openfgaContextualTuples by default', () => {
    expect(getAuthzContextualTuples(fakeEvent({ openfgaContextualTuples: TUPLES }))).toEqual(TUPLES)
  })

  it('reads a configured key', () => {
    runtimeOpenfga['contextualTuplesKey'] = 'roleTuples'
    expect(getAuthzContextualTuples(fakeEvent({ roleTuples: TUPLES, openfgaContextualTuples: [] }))).toEqual(TUPLES)
  })

  it('returns undefined when unset', () => {
    expect(getAuthzContextualTuples(fakeEvent({}))).toBeUndefined()
  })

  it('rejects malformed values instead of silently dropping them', () => {
    expect(() => getAuthzContextualTuples(fakeEvent({ openfgaContextualTuples: 'admin' }))).toThrow(TypeError)
    expect(() => getAuthzContextualTuples(fakeEvent({ openfgaContextualTuples: [{ user: 'user:a' }] }))).toThrow(TypeError)
  })
})

describe('requireRelation', () => {
  const guard = requireRelation('document', 'can_view', () => 'd1') as unknown as (e: H3Event) => Promise<void>

  it('responds 401 for a context user with no id rather than checking "user:undefined"', async () => {
    await expect(guard(fakeEvent({ user: {} }))).rejects.toMatchObject({ statusCode: 401 })
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('uses the configured user id path', async () => {
    runtimeOpenfga['userIdPath'] = 'auth.userId'
    mockCheck.mockResolvedValue({ allowed: true })
    await guard(fakeEvent({ auth: { userId: 'bob' } }))
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ user: 'user:bob', object: 'document:d1' }))
  })

  it('responds 403 when the check fails', async () => {
    mockCheck.mockResolvedValue({ allowed: false })
    await expect(guard(fakeEvent({ user: { id: 'alice' } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('passes contextual tuples only when asked', async () => {
    mockCheck.mockResolvedValue({ allowed: true })
    const withTuples = requireRelation('document', 'can_view', () => 'd1', getAuthzContextualTuples) as unknown as (e: H3Event) => Promise<void>
    await withTuples(fakeEvent({ user: { id: 'alice' }, openfgaContextualTuples: TUPLES }))
    expect(mockCheck).toHaveBeenLastCalledWith(expect.objectContaining({ contextualTuples: TUPLES }))

    clearAuthzCache()
    await guard(fakeEvent({ user: { id: 'alice' }, openfgaContextualTuples: TUPLES }))
    expect(mockCheck.mock.lastCall?.[0]).not.toHaveProperty('contextualTuples')
  })
})
