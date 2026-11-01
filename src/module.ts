import {
  addComponentsDir,
  addImportsDir,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import { defu } from 'defu'

export interface ModuleOptions {
  /** OpenFGA API URL. Also reads `OPENFGA_API_URL` or `NUXT_OPENFGA_API_URL`. */
  apiUrl?: string
  /** OpenFGA store ID. Also reads `OPENFGA_STORE_ID` or `NUXT_OPENFGA_STORE_ID`. */
  storeId?: string
  /** Authorization model ID. Also reads `OPENFGA_MODEL_ID` or `NUXT_OPENFGA_MODEL_ID`. */
  modelId?: string
  /**
   * Static headers sent with every request to the OpenFGA server, such as an
   * API token for a managed offering or an authenticating gateway. Merged with
   * `OPENFGA_HEADERS` / `NUXT_OPENFGA_HEADERS`; the environment wins on a key
   * collision.
   */
  headers?: Record<string, string>
  /** Maximum number of cached check decisions per server process. Default `10000`. */
  cacheMaxEntries?: number
  /** Lifetime of a cached check decision in milliseconds. Default `30000`. */
  cacheTtlMs?: number
  /**
   * Deploy the project's DSL model to the configured store when the Nitro
   * server starts. Only enable this for a server that accepts DSL bodies on
   * `POST /stores/:storeId/authorization-models` with
   * `Content-Type: application/x-openfga-dsl`. The upstream OpenFGA server
   * accepts only JSON; with it, deploy with the `fga` CLI instead. Default
   * `false`.
   */
  autoDeployModel?: boolean
  /**
   * Path to the `.fga` DSL file, relative to the server's working directory or
   * absolute. `OPENFGA_MODEL_FILE` overrides it at runtime. Default
   * `openfga/model.fga`.
   */
  modelFile?: string
  /**
   * Dot-separated path to the authenticated user's id on `event.context`.
   * `/api/_authz/check` and `requireRelation` read it to identify the subject
   * as `user:<id>`. Your authentication middleware must set it. Default
   * `user.id`.
   */
  userIdPath?: string
  /**
   * Key on `event.context` holding per-request contextual tuples
   * (`ContextualTupleKey[]`). `/api/_authz/check` passes them with every
   * check, so role facts kept in your own data can reach OpenFGA without
   * being persisted as tuples. Default `openfgaContextualTuples`.
   */
  contextualTuplesKey?: string
}

/** Server utilities exposed through Nitro auto-imports. */
const SERVER_IMPORTS: Record<string, string[]> = {
  './runtime/server/utils/openfga': [
    'useOpenFGAClient',
    'resetOpenFGAClient',
    'checkAccess',
    'checkAccessOrThrow',
    'listObjects',
    'writeRelationship',
    'deleteRelationship',
    'invalidateCache',
    'checkAccessForSubject',
    'checkAccessForSubjectOrThrow',
    'listObjectsForSubject',
    'writeRelationshipForSubject',
    'deleteRelationshipForSubject',
    'invalidateCacheForSubject',
    'clearAuthzCache',
    'getAuthzCacheStats',
    'requireRelation',
  ],
  './runtime/server/utils/event-context': [
    'getAuthzUserId',
    'getAuthzContextualTuples',
  ],
  './runtime/server/utils/memory-store': [
    'loadMemoryStore',
    'resetMemoryStore',
    'isMemoryMode',
  ],
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@developmentsprint/nuxt-openfga',
    configKey: 'openfga',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    cacheMaxEntries: 10_000,
    cacheTtlMs: 30_000,
    autoDeployModel: false,
    modelFile: 'openfga/model.fga',
    userIdPath: 'user.id',
    contextualTuplesKey: 'openfgaContextualTuples',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Server-only runtime config. Nuxt binds NUXT_OPENFGA_<KEY> env vars onto
    // these fields at startup; the runtime helpers also accept OPENFGA_<KEY>.
    // Values set here are serialized into the build, so options such as
    // modelFile reach the production server process. Values the host (or a
    // layer) already set under runtimeConfig.openfga take precedence.
    nuxt.options.runtimeConfig.openfga = defu(nuxt.options.runtimeConfig.openfga as Record<string, unknown> | undefined, {
      apiUrl: options.apiUrl || '',
      storeId: options.storeId || '',
      modelId: options.modelId || '',
      headers: options.headers || {},
      cacheMaxEntries: options.cacheMaxEntries!,
      cacheTtlMs: options.cacheTtlMs!,
      modelFile: options.modelFile || '',
      userIdPath: options.userIdPath!,
      contextualTuplesKey: options.contextualTuplesKey!,
    })

    for (const [path, names] of Object.entries(SERVER_IMPORTS)) {
      addServerImports(names.map(name => ({ name, from: resolve(path) })))
    }

    addImportsDir(resolve('./runtime/composables'))

    addComponentsDir({
      path: resolve('./runtime/components'),
      pathPrefix: false,
      prefix: '',
      global: true,
    })

    // Powers useCan and <Can>. The subject always comes from the session,
    // never from the request body.
    addServerHandler({
      route: '/api/_authz/check',
      method: 'post',
      handler: resolve('./runtime/server/routes/check.post'),
    })

    if (options.autoDeployModel) {
      addServerPlugin(resolve('./runtime/server/plugins/init-store'))
    }
  },
})

export default module

declare module '@nuxt/schema' {
  interface NuxtConfig {
    openfga?: ModuleOptions
  }
  interface NuxtOptions {
    openfga?: ModuleOptions
  }
}
