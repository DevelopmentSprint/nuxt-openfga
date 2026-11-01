import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const runtimeOpenfga: Record<string, unknown> = {}
const readFileSync = vi.fn((_path: string, _enc?: string) => 'model\n  schema 1.1\ntype user')

vi.mock('#imports', () => ({
  defineNitroPlugin: (fn: unknown) => fn,
  useRuntimeConfig: () => ({ openfga: runtimeOpenfga }),
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readFileSync: (path: string, enc?: string) => readFileSync(path, enc) }
})

const ENV_KEYS = ['OPENFGA_MODE', 'OPENFGA_API_URL', 'OPENFGA_STORE_ID', 'OPENFGA_MODEL_ID', 'OPENFGA_MODEL_FILE', 'NUXT_OPENFGA_MODEL_FILE', 'NUXT_OPENFGA_MODEL_ID']
const savedEnv: Record<string, string | undefined> = {}

async function runPlugin(): Promise<void> {
  vi.resetModules()
  const mod = await import('../../src/runtime/server/plugins/init-store')
  await (mod.default as unknown as () => Promise<void>)()
}

describe('init-store plugin — model file location', () => {
  beforeEach(() => {
    readFileSync.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authorization_model_id: 'm1' }) }))
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      Reflect.deleteProperty(process.env, k)
    }
    Object.keys(runtimeOpenfga).forEach(k => Reflect.deleteProperty(runtimeOpenfga, k))
    process.env['OPENFGA_API_URL'] = 'http://openfga.test'
    process.env['OPENFGA_STORE_ID'] = 'store-1'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = savedEnv[k]
    }
  })

  it('reads the modelFile option from runtime config, so it works in production builds', async () => {
    runtimeOpenfga['modelFile'] = 'authz/app.fga'
    await runPlugin()
    expect(readFileSync).toHaveBeenCalledWith(resolve(process.cwd(), 'authz/app.fga'), 'utf8')
  })

  it('lets OPENFGA_MODEL_FILE override the option', async () => {
    runtimeOpenfga['modelFile'] = 'authz/app.fga'
    process.env['OPENFGA_MODEL_FILE'] = '/etc/fga/model.fga'
    await runPlugin()
    expect(readFileSync).toHaveBeenCalledWith('/etc/fga/model.fga', 'utf8')
  })

  it('falls back to openfga/model.fga', async () => {
    await runPlugin()
    expect(readFileSync).toHaveBeenCalledWith(resolve(process.cwd(), 'openfga', 'model.fga'), 'utf8')
  })

  it('deploys with apiUrl and storeId set only in nuxt.config', async () => {
    Reflect.deleteProperty(process.env, 'OPENFGA_API_URL')
    Reflect.deleteProperty(process.env, 'OPENFGA_STORE_ID')
    runtimeOpenfga['apiUrl'] = 'http://config.test/'
    runtimeOpenfga['storeId'] = 'store-cfg'
    await runPlugin()
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://config.test/stores/store-cfg/authorization-models')
  })

  it('treats a modelId set in nuxt.config as pinned and does not deploy', async () => {
    runtimeOpenfga['modelId'] = 'pinned-in-config'
    await runPlugin()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(process.env['OPENFGA_MODEL_ID']).toBeUndefined()
  })
})
