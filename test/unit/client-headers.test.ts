import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useOpenFGAClient,
  resetOpenFGAClient,
} from '../../src/runtime/server/utils/openfga'

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

const runtimeOpenfga: Record<string, unknown> = {
  apiUrl: 'http://openfga.test',
  storeId: 'store-id',
  modelId: 'model-id',
  cacheMaxEntries: 10_000,
  cacheTtlMs: 30_000,
}

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ openfga: runtimeOpenfga }),
  createError: (error: Record<string, unknown>) => Object.assign(new Error(String(error.message ?? 'Error')), error),
  defineEventHandler: (handler: unknown) => handler,
}))

describe('useOpenFGAClient — custom headers', () => {
  beforeEach(() => {
    resetOpenFGAClient()
    ctorSpy.mockClear()
    delete process.env['OPENFGA_HEADERS']
    delete process.env['NUXT_OPENFGA_HEADERS']
    runtimeOpenfga['headers'] = undefined
  })

  afterEach(() => {
    delete process.env['OPENFGA_HEADERS']
    delete process.env['NUXT_OPENFGA_HEADERS']
    runtimeOpenfga['headers'] = undefined
  })

  it('omits baseOptions entirely when no headers are configured', () => {
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(params).toBeDefined()
    expect(params['baseOptions']).toBeUndefined()
  })

  it('passes module-option headers via baseOptions when env is unset', () => {
    runtimeOpenfga['headers'] = { 'X-Tenant': 'from-config' }
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as { baseOptions?: { headers?: Record<string, string> } }
    expect(params.baseOptions?.headers).toEqual({ 'X-Tenant': 'from-config' })
  })

  it('passes env-only headers via baseOptions when module option is unset', () => {
    process.env['OPENFGA_HEADERS'] = 'X-Tenant: from-env, Authorization: Bearer xyz'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as { baseOptions?: { headers?: Record<string, string> } }
    expect(params.baseOptions?.headers).toEqual({
      'X-Tenant': 'from-env',
      'Authorization': 'Bearer xyz',
    })
  })

  it('accepts NUXT_OPENFGA_HEADERS as an alias for OPENFGA_HEADERS', () => {
    process.env['NUXT_OPENFGA_HEADERS'] = 'X-Tenant: nuxt-form'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as { baseOptions?: { headers?: Record<string, string> } }
    expect(params.baseOptions?.headers).toEqual({ 'X-Tenant': 'nuxt-form' })
  })

  it('lets NUXT_OPENFGA_HEADERS win when both bare and NUXT_ env vars are set', () => {
    process.env['OPENFGA_HEADERS'] = 'X-Tenant: bare-form'
    process.env['NUXT_OPENFGA_HEADERS'] = 'X-Tenant: nuxt-form'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as { baseOptions?: { headers?: Record<string, string> } }
    expect(params.baseOptions?.headers).toEqual({ 'X-Tenant': 'nuxt-form' })
  })

  it('merges module-option and env headers with env winning on collision', () => {
    runtimeOpenfga['headers'] = {
      'X-Tenant': 'from-config',
      'Authorization': 'config-auth',
    }
    process.env['OPENFGA_HEADERS'] = 'Authorization: env-wins, X-Other: env-only'
    useOpenFGAClient()
    const params = ctorSpy.mock.calls[0]?.[0] as { baseOptions?: { headers?: Record<string, string> } }
    expect(params.baseOptions?.headers).toEqual({
      'X-Tenant': 'from-config',
      'Authorization': 'env-wins',
      'X-Other': 'env-only',
    })
  })
})

describe('headers from NUXT_OPENFGA_HEADERS bound onto runtimeConfig', () => {
  it('ignores a string where Nitro replaced the headers object, instead of sending one header per character', async () => {
    const { mergeHeaders } = await import('../../src/runtime/server/utils/headers')
    const { configHeaders } = await import('../../src/runtime/server/utils/headers')
    expect(configHeaders('Authorization: Bearer x')).toEqual({})
    expect(configHeaders({ 'X-Tenant': 'acme' })).toEqual({ 'X-Tenant': 'acme' })
    expect(configHeaders(undefined)).toEqual({})
    expect(mergeHeaders(configHeaders('ab'), { A: '1' })).toEqual({ A: '1' })
  })
})
