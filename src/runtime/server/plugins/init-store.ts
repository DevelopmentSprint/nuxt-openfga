/**
 * Nitro startup plugin — deploy the project's OpenFGA model on boot.
 *
 * The plugin reads the project's `model.fga` (DSL source-of-truth),
 * POSTs it to the configured OpenFGA-wire-compatible server with
 * `Content-Type: application/x-openfga-dsl`, and pins the resulting
 * `authorization_model_id` via `process.env.OPENFGA_MODEL_ID` so the
 * SDK wrapper picks it up on its next call.
 *
 * The endpoint must accept DSL bodies. The upstream OpenFGA server accepts
 * only JSON models, which is why `openfga.autoDeployModel` defaults to false;
 * with it, deploy the model with the `fga` CLI instead.
 *
 * Failure modes (server unreachable, store not found, malformed DSL,
 * etc.) are logged but do not crash the dev server — the calling
 * application can decide how to handle authz being temporarily
 * unavailable. Most checks will 5xx until the server comes online.
 *
 * Configuration:
 *   - `OPENFGA_API_URL`     — required. Base URL of the OpenFGA server.
 *   - `OPENFGA_STORE_ID`    — required. Create a store once per environment.
 *   - `OPENFGA_MODEL_FILE`  — optional. Path to the .fga DSL file. Falls back
 *                             to the `openfga.modelFile` option, then
 *                             `<cwd>/openfga/model.fga`.
 *   - `OPENFGA_MODEL_ID`    — optional override. If set, the plugin
 *                             skips deployment entirely (the operator
 *                             has pinned a specific historical model).
 */
import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve as resolvePath, isAbsolute } from 'node:path'
import { parseHeaders, mergeHeaders, envValue, configHeaders } from '../utils/headers'

const DSL_CONTENT_TYPE = 'application/x-openfga-dsl'

interface WriteAuthorizationModelResponse {
  authorization_model_id: string
}

export default defineNitroPlugin(async () => {
  // Memory mode owns its own model state via loadMemoryStore(); the
  // startup deploy targets a wire-protocol server that isn't running.
  if (envValue('OPENFGA_MODE') === 'memory') {
    console.info('[openfga] OPENFGA_MODE=memory — skipping startup model deploy.')
    return
  }

  // Read the same sources as useOpenFGAClient: env first, then the module
  // options carried in runtimeConfig.
  const runtimeConfig = useRuntimeConfig()
  const openfga = (runtimeConfig as { openfga?: Record<string, unknown> }).openfga
  const fromConfig = (key: string): string => {
    const value = openfga?.[key]
    return typeof value === 'string' ? value : ''
  }

  // A pinned model id, from env or nuxt.config, wins; skip deployment.
  const pinnedModelId = envValue('OPENFGA_MODEL_ID') || fromConfig('modelId')
  if (pinnedModelId) {
    console.info('[openfga] model id is pinned — skipping startup model deploy.', { id: pinnedModelId })
    return
  }

  const apiUrl = (envValue('OPENFGA_API_URL') || fromConfig('apiUrl')).replace(/\/$/, '')
  const storeId = (envValue('OPENFGA_STORE_ID') || fromConfig('storeId')).trim()

  if (!apiUrl) {
    console.warn('[openfga] no API URL (OPENFGA_API_URL or openfga.apiUrl) — skipping model bootstrap.')
    return
  }
  if (!storeId) {
    console.warn(
      '[openfga] no store id (OPENFGA_STORE_ID or openfga.storeId). Create a store (for example `fga store create --name <app>`) and set it. Skipping model bootstrap.',
    )
    return
  }

  // Locate the DSL file: env override, then the module option (carried in
  // runtimeConfig so it survives `nuxt build`), then the conventional path.
  // Relative paths resolve against the server's working directory.
  const configuredPath = envValue('OPENFGA_MODEL_FILE') || fromConfig('modelFile')
  const modelPath = configuredPath
    ? (isAbsolute(configuredPath) ? configuredPath : resolvePath(process.cwd(), configuredPath))
    : resolvePath(process.cwd(), 'openfga', 'model.fga')

  let dsl: string
  try {
    dsl = readFileSync(modelPath, 'utf8')
  }
  catch (err) {
    console.error('[openfga] could not read model file', { modelPath, err })
    return
  }

  // Static headers for managed offerings and authenticating gateways. The
  // `openfga.headers` option is the committed default; OPENFGA_HEADERS /
  // NUXT_OPENFGA_HEADERS override it per environment.
  const customHeaders = mergeHeaders(
    configHeaders(openfga?.['headers']),
    parseHeaders(
      envValue('OPENFGA_HEADERS'),
      (_entry, index) => console.warn('[openfga] OPENFGA_HEADERS: ignoring malformed entry', { index }),
    ),
  )

  // Content-derived Idempotency-Key. Servers that honor it return the
  // existing model on repeat boots with unchanged DSL instead of creating a
  // new model row. Different
  // DSL content → different key → new row, preserving OpenFGA's
  // immutable-model semantics. Servers without idempotency middleware
  // ignore the header and always create a new row, which is also fine.
  const idempotencyKey = `nuxt-openfga-init:${createHash('sha256').update(dsl).digest('hex')}`

  let res: Response
  try {
    res = await fetch(`${apiUrl}/stores/${storeId}/authorization-models`, {
      method: 'POST',
      // Spread custom headers FIRST so SDK-required headers cannot be
      // accidentally clobbered by an operator-supplied OPENFGA_HEADERS
      // value.
      headers: {
        ...customHeaders,
        'content-type': DSL_CONTENT_TYPE,
        'idempotency-key': idempotencyKey,
      },
      body: dsl,
    })
  }
  catch (err) {
    console.error('[openfga] could not reach OpenFGA server', {
      apiUrl,
      message: err instanceof Error ? err.message : String(err),
    })
    return
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[openfga] write-model failed', {
      status: res.status,
      statusText: res.statusText,
      body: text,
    })
    return
  }

  let body: WriteAuthorizationModelResponse
  try {
    body = (await res.json()) as WriteAuthorizationModelResponse
  }
  catch (err) {
    console.error('[openfga] write-model response was not valid JSON', { err })
    return
  }

  if (!body.authorization_model_id) {
    console.error('[openfga] write-model response missing authorization_model_id')
    return
  }

  // Publish the resolved id via env so the SDK wrapper picks it up on
  // its next `useOpenFGAClient()` call.
  process.env['OPENFGA_MODEL_ID'] = body.authorization_model_id
  console.info('[openfga] deployed authorization model', { id: body.authorization_model_id })
})
