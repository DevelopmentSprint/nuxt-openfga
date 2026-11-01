/**
 * Cross-cutting NUXT_OPENFGA_* env-var alias coverage. The bare OPENFGA_*
 * forms remain supported; NUXT_OPENFGA_* exists so operators using Nuxt's
 * runtimeConfig override convention get equivalent behavior. The
 * NUXT_-prefixed wins on collision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useOpenFGAClient,
  resetOpenFGAClient,
} from '../../src/runtime/server/utils/openfga'
import { isMemoryMode } from '../../src/runtime/server/utils/memory-store'

const ctorSpy = vi.fn()

vi.mock('@openfga/sdk', () => ({
  OpenFgaClient: vi.fn(function (this: unknown, params: unknown) {
    ctorSpy(params)
    Object.assign(this as object, {
      check: vi.fn(),
      write: vi.fn(),
      listObjects: vi.fn(),
    })
  }),
}))

const runtimeOpenfga: Record<string, unknown> = {}

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ openfga: runtimeOpenfga }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
  defineEventHandler: (handler: unknown) => handler,
}))

const ENV_KEYS = [
  'OPENFGA_API_URL', 'NUXT_OPENFGA_API_URL',
  'OPENFGA_STORE_ID', 'NUXT_OPENFGA_STORE_ID',
  'OPENFGA_MODEL_ID', 'NUXT_OPENFGA_MODEL_ID',
  'OPENFGA_MODE', 'NUXT_OPENFGA_MODE',
]
const savedEnv: Record<string, string | undefined> = {}

describe('useOpenFGAClient — NUXT_ env aliases', () => {
  beforeEach(() => {
    resetOpenFGAClient()
    ctorSpy.mockClear()
    Object.keys(runtimeOpenfga).forEach(k => Reflect.deleteProperty(runtimeOpenfga, k))
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      Reflect.deleteProperty(process.env, k)
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = savedEnv[k]
    }
  })

  it('uses NUXT_OPENFGA_API_URL when only NUXT_ form is set', () => {
    process.env['NUXT_OPENFGA_API_URL'] = 'http://from-nuxt'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params['apiUrl']).toBe('http://from-nuxt')
  })

  it('NUXT_OPENFGA_API_URL wins over OPENFGA_API_URL', () => {
    process.env['OPENFGA_API_URL'] = 'http://from-bare'
    process.env['NUXT_OPENFGA_API_URL'] = 'http://from-nuxt'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params['apiUrl']).toBe('http://from-nuxt')
  })

  it('uses NUXT_OPENFGA_STORE_ID when only NUXT_ form is set', () => {
    process.env['NUXT_OPENFGA_API_URL'] = 'http://x'
    process.env['NUXT_OPENFGA_STORE_ID'] = 'store-from-nuxt'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params['storeId']).toBe('store-from-nuxt')
  })

  it('uses NUXT_OPENFGA_MODEL_ID when only NUXT_ form is set', () => {
    process.env['NUXT_OPENFGA_API_URL'] = 'http://x'
    process.env['NUXT_OPENFGA_MODEL_ID'] = 'model-from-nuxt'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params['authorizationModelId']).toBe('model-from-nuxt')
  })
})

describe('isMemoryMode — NUXT_OPENFGA_MODE alias', () => {
  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'OPENFGA_MODE')
    Reflect.deleteProperty(process.env, 'NUXT_OPENFGA_MODE')
  })
  afterEach(() => {
    Reflect.deleteProperty(process.env, 'OPENFGA_MODE')
    Reflect.deleteProperty(process.env, 'NUXT_OPENFGA_MODE')
  })

  it('returns false when neither form is set', () => {
    expect(isMemoryMode()).toBe(false)
  })

  it('respects bare OPENFGA_MODE=memory', () => {
    process.env['OPENFGA_MODE'] = 'memory'
    expect(isMemoryMode()).toBe(true)
  })

  it('respects NUXT_OPENFGA_MODE=memory', () => {
    process.env['NUXT_OPENFGA_MODE'] = 'memory'
    expect(isMemoryMode()).toBe(true)
  })

  it('NUXT_OPENFGA_MODE wins over OPENFGA_MODE on collision', () => {
    process.env['OPENFGA_MODE'] = 'server'
    process.env['NUXT_OPENFGA_MODE'] = 'memory'
    expect(isMemoryMode()).toBe(true)
  })
})
