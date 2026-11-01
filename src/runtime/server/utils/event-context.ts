/**
 * Read authorization inputs that the host application's middleware places on
 * `event.context`. The locations are configurable (`openfga.userIdPath` and
 * `openfga.contextualTuplesKey`), so the module works with any authentication
 * layer.
 */
import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'

export interface ContextualTupleKey {
  user: string
  relation: string
  object: string
}

const DEFAULT_USER_ID_PATH = 'user.id'
const DEFAULT_CONTEXTUAL_TUPLES_KEY = 'openfgaContextualTuples'

function readConfig(): { userIdPath: string, contextualTuplesKey: string } {
  let openfga: Record<string, unknown> | undefined
  try {
    openfga = (useRuntimeConfig() as { openfga?: Record<string, unknown> }).openfga
  }
  catch {
    // Outside a Nitro context (plain unit tests): fall back to defaults.
  }
  return {
    userIdPath: (openfga?.['userIdPath'] as string) || DEFAULT_USER_ID_PATH,
    contextualTuplesKey: (openfga?.['contextualTuplesKey'] as string) || DEFAULT_CONTEXTUAL_TUPLES_KEY,
  }
}

function readPath(root: unknown, path: string): unknown {
  let current = root
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * The authenticated user's id at `openfga.userIdPath` on `event.context`, or
 * `undefined` when the request is anonymous. Numeric ids are stringified;
 * empty strings and other types count as anonymous.
 */
export function getAuthzUserId(event: H3Event): string | undefined {
  const value = readPath(event.context, readConfig().userIdPath)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}

function isTupleKey(value: unknown): value is ContextualTupleKey {
  if (value === null || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  return typeof t['user'] === 'string' && typeof t['relation'] === 'string' && typeof t['object'] === 'string'
}

/**
 * Contextual tuples stored at `openfga.contextualTuplesKey` on
 * `event.context`. Returns `undefined` when the key is unset. Throws when it
 * holds something other than an array of tuple keys, because silently dropping
 * them would change authorization results.
 */
export function getAuthzContextualTuples(event: H3Event): ContextualTupleKey[] | undefined {
  const key = readConfig().contextualTuplesKey
  const value = event.context[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || !value.every(isTupleKey)) {
    throw new TypeError(`[nuxt-openfga] event.context.${key} must be an array of { user, relation, object } tuple keys`)
  }
  return value
}
