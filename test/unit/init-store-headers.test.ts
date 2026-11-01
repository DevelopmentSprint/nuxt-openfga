import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()
const okJson = (body: unknown): Response => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
  text: async () => JSON.stringify(body),
} as unknown as Response)

const runtimeOpenfga: Record<string, unknown> = {}

vi.mock('#imports', () => ({
  defineNitroPlugin: (fn: unknown) => fn,
  useRuntimeConfig: () => ({ openfga: runtimeOpenfga }),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    readFileSync: vi.fn(() => 'model\n  schema 1.1\ntype user'),
  }
})

const ENV_KEYS = [
  'OPENFGA_MODE', 'NUXT_OPENFGA_MODE',
  'OPENFGA_API_URL', 'NUXT_OPENFGA_API_URL',
  'OPENFGA_STORE_ID', 'NUXT_OPENFGA_STORE_ID',
  'OPENFGA_MODEL_ID', 'NUXT_OPENFGA_MODEL_ID',
  'OPENFGA_HEADERS', 'NUXT_OPENFGA_HEADERS',
  'OPENFGA_MODEL_FILE', 'NUXT_OPENFGA_MODEL_FILE',
]
const savedEnv: Record<string, string | undefined> = {}

async function loadPlugin(): Promise<() => Promise<void>> {
  vi.resetModules()
  const mod = await import('../../src/runtime/server/plugins/init-store')
  return mod.default as unknown as () => Promise<void>
}

describe('init-store plugin — custom headers', () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(okJson({ authorization_model_id: 'model-xyz' }))
    vi.stubGlobal('fetch', fetchSpy)
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      Reflect.deleteProperty(process.env, k)
    }
    Object.keys(runtimeOpenfga).forEach(k => Reflect.deleteProperty(runtimeOpenfga, k))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = savedEnv[k]
    }
  })

  it('sends only content-type and idempotency-key when no headers are configured', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    const run = await loadPlugin()
    await run()

    expect(fetchSpy).toHaveBeenCalledOnce()
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toEqual({
      'content-type': 'application/x-openfga-dsl',
      'idempotency-key': expect.stringMatching(/^nuxt-openfga-init:[a-f0-9]{64}$/),
    })
  })

  it('attaches OPENFGA_HEADERS env values to the model-deploy fetch', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    process.env['OPENFGA_HEADERS'] = 'Authorization: Bearer xyz, X-Tenant: rp'
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({
      'Authorization': 'Bearer xyz',
      'X-Tenant': 'rp',
      'content-type': 'application/x-openfga-dsl',
    })
  })

  it('attaches runtimeConfig.openfga.headers when env is unset', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    runtimeOpenfga['headers'] = { 'X-Tenant': 'config-only' }
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ 'X-Tenant': 'config-only' })
  })

  it('lets env-supplied headers override module-option headers on key collision', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    runtimeOpenfga['headers'] = { 'Authorization': 'config-auth' }
    process.env['OPENFGA_HEADERS'] = 'Authorization: env-wins'
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('env-wins')
  })

  it('does not let user-supplied headers override the required content-type', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    process.env['OPENFGA_HEADERS'] = 'content-type: text/plain'
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-openfga-dsl')
  })

  it('accepts NUXT_OPENFGA_HEADERS as an alias for OPENFGA_HEADERS', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    process.env['NUXT_OPENFGA_HEADERS'] = 'X-Tenant: nuxt-form'
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ 'X-Tenant': 'nuxt-form' })
  })

  it('lets NUXT_OPENFGA_HEADERS win when both bare and NUXT_ env vars are set', async () => {
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
    process.env['OPENFGA_HEADERS'] = 'X-Tenant: bare-form'
    process.env['NUXT_OPENFGA_HEADERS'] = 'X-Tenant: nuxt-form'
    const run = await loadPlugin()
    await run()

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Tenant']).toBe('nuxt-form')
  })

  it('does not call fetch in OPENFGA_MODE=memory (regression guard)', async () => {
    process.env['OPENFGA_MODE'] = 'memory'
    process.env['OPENFGA_HEADERS'] = 'Authorization: Bearer X'
    const run = await loadPlugin()
    await run()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('NUXT_OPENFGA_MODE=memory short-circuits the plugin', async () => {
    process.env['NUXT_OPENFGA_MODE'] = 'memory'
    const run = await loadPlugin()
    await run()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('NUXT_OPENFGA_MODEL_ID pinning short-circuits the plugin', async () => {
    process.env['NUXT_OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['NUXT_OPENFGA_STORE_ID'] = 'store-1'
    process.env['NUXT_OPENFGA_MODEL_ID'] = 'pinned-historical-id'
    const run = await loadPlugin()
    await run()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses NUXT_OPENFGA_API_URL and NUXT_OPENFGA_STORE_ID when set', async () => {
    process.env['NUXT_OPENFGA_API_URL'] = 'http://from-nuxt-env'
    process.env['NUXT_OPENFGA_STORE_ID'] = 'store-from-nuxt'
    const run = await loadPlugin()
    await run()
    expect(fetchSpy).toHaveBeenCalledOnce()
    const url = fetchSpy.mock.calls[0]?.[0] as string
    expect(url).toBe('http://from-nuxt-env/stores/store-from-nuxt/authorization-models')
  })
})
