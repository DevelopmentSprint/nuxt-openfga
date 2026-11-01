/**
 * OpenFGA server utilities, auto-imported into the host's Nitro server.
 *
 * Two families with the same behavior:
 *   Subject form (canonical): the subject is the OpenFGA wire string, such as
 *     "user:alice", "group:eng#member" or "user:*".
 *     checkAccessForSubject, checkAccessForSubjectOrThrow,
 *     writeRelationshipForSubject, deleteRelationshipForSubject,
 *     listObjectsForSubject, invalidateCacheForSubject
 *   User form (shorthand): takes a bare user id and prepends "user:".
 *     checkAccess, checkAccessOrThrow, writeRelationship,
 *     deleteRelationship, listObjects, invalidateCache
 *   Plus: useOpenFGAClient, resetOpenFGAClient, requireRelation,
 *         clearAuthzCache, getAuthzCacheStats
 *
 * The module has no knowledge of your model's types. Helpers that name
 * specific types belong in the host application.
 */

import { OpenFgaClient } from '@openfga/sdk'
import { useRuntimeConfig, createError } from '#imports'
import { defineEventHandler } from 'h3'
import type { H3Event } from 'h3'
import { MemoryFgaClient, isMemoryMode } from './memory-store'
import { parseHeaders, mergeHeaders, envValue, configHeaders } from './headers'
import { getAuthzUserId, type ContextualTupleKey } from './event-context'

export type { ContextualTupleKey } from './event-context'

// ─── Client ────────────────────────────────────────────────

let _client: OpenFgaClient | null = null

export function useOpenFGAClient(): OpenFgaClient {
  if (_client) return _client

  if (isMemoryMode()) {
    _client = new MemoryFgaClient() as unknown as OpenFgaClient
    return _client
  }

  const config = useRuntimeConfig()
  const openfga = config.openfga as Record<string, unknown> | undefined

  const apiUrl = envValue('OPENFGA_API_URL')
    || (openfga?.['apiUrl'] as string)
    || ''
  const storeId = envValue('OPENFGA_STORE_ID')
    || (openfga?.['storeId'] as string)
    || ''
  const modelId = envValue('OPENFGA_MODEL_ID')
    || (openfga?.['modelId'] as string)
    || ''

  if (!apiUrl) {
    throw new Error('[nuxt-openfga] API URL not configured. Set OPENFGA_API_URL env var or openfga.apiUrl in nuxt.config.')
  }

  const headers = mergeHeaders(
    configHeaders(openfga?.['headers']),
    parseHeaders(
      envValue('OPENFGA_HEADERS'),
      (_entry, index) => console.warn('[nuxt-openfga] OPENFGA_HEADERS: ignoring malformed entry', { index }),
    ),
  )

  _client = new OpenFgaClient({
    apiUrl,
    storeId: storeId || undefined,
    authorizationModelId: modelId || undefined,
    ...(Object.keys(headers).length > 0 ? { baseOptions: { headers } } : {}),
  })

  return _client
}

/** Reset client (for testing). */
export function resetOpenFGAClient(): void {
  _client = null
}

// ─── Cache ─────────────────────────────────────────────────

/** The subject and object a cached decision is about, used for invalidation. */
interface CacheScope {
  subject: string
  objectType: string
  objectId: string
}

interface CacheEntry {
  allowed: boolean
  expiresAt: number
  scope?: CacheScope
}

const DEFAULT_CACHE_MAX_ENTRIES = 10_000
const DEFAULT_CACHE_TTL_MS = 30_000

/**
 * Per-process LRU cache of check decisions. A `Map` iterates in insertion
 * order, so re-inserting an entry on every hit keeps the least recently used
 * entry first, ready for eviction.
 */
const _cache = new Map<string, CacheEntry>()

/**
 * Bumped by every invalidation. A check records it before awaiting OpenFGA
 * and caches its answer only if no invalidation happened meanwhile, so a
 * decision computed before a write cannot be stored after it.
 */
let _generation = 0

function getCacheConfig() {
  try {
    const config = useRuntimeConfig()
    const openfga = config.openfga as Record<string, unknown> | undefined
    return {
      maxEntries: (openfga?.['cacheMaxEntries'] as number) ?? DEFAULT_CACHE_MAX_ENTRIES,
      ttlMs: (openfga?.['cacheTtlMs'] as number) ?? DEFAULT_CACHE_TTL_MS,
    }
  }
  catch {
    return { maxEntries: DEFAULT_CACHE_MAX_ENTRIES, ttlMs: DEFAULT_CACHE_TTL_MS }
  }
}

/**
 * Build a cache key. Components are JSON-encoded, so no subject, relation or
 * id, whatever characters it contains, can make two different questions share
 * a key.
 *
 * Contextual tuples participate in the key when present: two checks for the
 * same (subject, relation, object) with different ad-hoc tuple sets may
 * resolve differently and must not share a slot. Tuples are sorted first, so
 * input order does not change the key.
 */
function cacheKey(
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
  contextualTuples?: ContextualTupleKey[],
): string {
  const parts: unknown[] = [subject, relation, objectType, objectId]
  if (contextualTuples && contextualTuples.length > 0) {
    parts.push(contextualTuples.map(t => [t.user, t.relation, t.object]).sort((a, b) => {
      const ka = JSON.stringify(a)
      const kb = JSON.stringify(b)
      return ka < kb ? -1 : ka > kb ? 1 : 0
    }))
  }
  return JSON.stringify(parts)
}

function cacheGet(key: string): boolean | undefined {
  const cached = _cache.get(key)
  if (!cached) {
    return undefined
  }

  if (cached.expiresAt <= Date.now()) {
    _cache.delete(key)
    return undefined
  }

  // Refresh recency.
  _cache.delete(key)
  _cache.set(key, cached)
  return cached.allowed
}

function cacheSet(key: string, allowed: boolean, scope?: CacheScope): void {
  const { maxEntries, ttlMs } = getCacheConfig()
  _cache.delete(key)
  if (maxEntries <= 0) return // caching disabled
  while (_cache.size >= maxEntries) {
    const lru = _cache.keys().next()
    if (lru.done) break
    _cache.delete(lru.value)
  }

  _cache.set(key, { allowed, expiresAt: Date.now() + ttlMs, scope })
}

/**
 * Delete cached decisions matching the given scope fields. Matching compares
 * the stored fields, not key substrings, so entries keyed with contextual
 * tuples are removed too.
 */
function cacheInvalidate(match: Partial<CacheScope>): void {
  _generation += 1
  for (const [key, entry] of _cache) {
    const scope = entry.scope
    if (!scope) continue
    if (match.subject !== undefined && scope.subject !== match.subject) continue
    if (match.objectType !== undefined && scope.objectType !== match.objectType) continue
    if (match.objectId !== undefined && scope.objectId !== match.objectId) continue
    _cache.delete(key)
  }
}

function cacheInvalidateForObject(objectType: string, objectId: string): void {
  cacheInvalidate({ objectType, objectId })
}

/**
 * Empty the decision cache. Call this after a change whose effect reaches
 * beyond one subject and object, such as adding a user to a group that
 * grants access elsewhere.
 */
export function clearAuthzCache(): void {
  _generation += 1
  _cache.clear()
}

export function getAuthzCacheStats() {
  const { maxEntries, ttlMs } = getCacheConfig()
  return { size: _cache.size, maxEntries, ttlMs }
}

// ─── Contextual tuples ─────────────────────────────────────

/**
 * Options for a single check. `contextualTuples` are added to the tuple set
 * for this check only and never persisted: use them to bring in facts your
 * application already stores, such as roles, without duplicating them as
 * OpenFGA tuples. The shape mirrors `@openfga/sdk`'s `TupleKey`.
 */
export interface CheckOptions {
  contextualTuples?: ContextualTupleKey[]
}

// ─── Subject-form (canonical) ──────────────────────────────

/**
 * Check whether a subject has a relation to an object. Cached.
 *
 * `subject` is the OpenFGA wire form, such as "user:alice", "team:eng" or
 * "group:g-1#member". It is passed to the SDK verbatim.
 *
 * `options.contextualTuples`, when supplied, augment the tuple set for
 * the duration of this check only. They participate in the cache key so
 * different tuple sets do not share a cache slot.
 */
export async function checkAccessForSubject(
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
  options?: CheckOptions,
): Promise<boolean> {
  const contextualTuples = options?.contextualTuples
  const key = cacheKey(subject, relation, objectType, objectId, contextualTuples)
  const cached = cacheGet(key)
  if (cached !== undefined) {
    return cached
  }

  const generation = _generation
  const client = useOpenFGAClient()
  const { allowed } = await client.check({
    user: subject,
    relation,
    object: `${objectType}:${objectId}`,
    ...(contextualTuples && contextualTuples.length > 0
      ? { contextualTuples }
      : {}),
  })

  if (generation === _generation) {
    cacheSet(key, !!allowed, { subject, objectType, objectId })
  }

  return !!allowed
}

/** Check access for a subject; throw 403 if denied. */
export async function checkAccessForSubjectOrThrow(
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
  options?: CheckOptions,
): Promise<void> {
  const allowed = await checkAccessForSubject(subject, relation, objectType, objectId, options)
  if (!allowed) {
    throw createError({
      statusCode: 403,
      message: `Access denied: ${relation} on ${objectType}:${objectId}`,
    })
  }
}

/** Write a relationship tuple with an arbitrary subject. */
export async function writeRelationshipForSubject(
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  const client = useOpenFGAClient()
  await client.write({
    writes: [{ user: subject, relation, object: `${objectType}:${objectId}` }],
  })
  // Any tuple on an object can change decisions for other subjects on it
  // (wildcards, usersets, tupleToUserset parents), so clear them all.
  cacheInvalidateForObject(objectType, objectId)
}

/** Delete a relationship tuple with an arbitrary subject. */
export async function deleteRelationshipForSubject(
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  const client = useOpenFGAClient()
  await client.write({
    deletes: [{ user: subject, relation, object: `${objectType}:${objectId}` }],
  })
  cacheInvalidateForObject(objectType, objectId)
}

/** List objects of `objectType` that `subject` has `relation` on. */
export async function listObjectsForSubject(
  subject: string,
  relation: string,
  objectType: string,
): Promise<string[]> {
  const client = useOpenFGAClient()
  const response = await client.listObjects({
    user: subject,
    relation,
    type: objectType,
  })
  return response.objects ?? []
}

/**
 * Invalidate cached decisions for a subject and object, across all relations
 * and contextual tuple sets. Decisions for other subjects that reach this
 * object through a userset are not touched; see `clearAuthzCache`.
 */
export function invalidateCacheForSubject(subject: string, objectType: string, objectId: string): void {
  cacheInvalidate({ subject, objectType, objectId })
}

// ─── User-form (back-compat wrappers) ──────────────────────

/**
 * Check if a user has a relation to an object. Cached. Equivalent to
 * `checkAccessForSubject('user:' + userId, ...)`.
 */
export async function checkAccess(
  userId: string,
  relation: string,
  objectType: string,
  objectId: string,
  options?: CheckOptions,
): Promise<boolean> {
  return checkAccessForSubject(`user:${userId}`, relation, objectType, objectId, options)
}

/** Check access; throw 403 if denied. */
export async function checkAccessOrThrow(
  userId: string,
  relation: string,
  objectType: string,
  objectId: string,
  options?: CheckOptions,
): Promise<void> {
  return checkAccessForSubjectOrThrow(`user:${userId}`, relation, objectType, objectId, options)
}

/** Write a relationship tuple. */
export async function writeRelationship(
  userId: string,
  relation: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  return writeRelationshipForSubject(`user:${userId}`, relation, objectType, objectId)
}

/** Delete a relationship tuple. */
export async function deleteRelationship(
  userId: string,
  relation: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  return deleteRelationshipForSubject(`user:${userId}`, relation, objectType, objectId)
}

/** List objects a user has a relation to. */
export async function listObjects(
  userId: string,
  relation: string,
  objectType: string,
): Promise<string[]> {
  return listObjectsForSubject(`user:${userId}`, relation, objectType)
}

/** Invalidate cache entries for a user+object pair (all relations). */
export function invalidateCache(userId: string, objectType: string, objectId: string): void {
  invalidateCacheForSubject(`user:${userId}`, objectType, objectId)
}

export const _testing = {
  cacheGet,
  cacheSet,
  cacheKey,
  cacheInvalidateForObject,
  CACHE_TTL_MS: DEFAULT_CACHE_TTL_MS,
  CACHE_MAX_SIZE: DEFAULT_CACHE_MAX_ENTRIES,
  _cache,
}

// ─── H3 Middleware Helpers ──────────────────────────────────

/**
 * Route guard that requires the signed-in user to hold `relation` on
 * `objectType:<id>`. Responds 401 when no user id is found at
 * `openfga.userIdPath`, 400 when `getObjectId` returns nothing, and 403 when
 * the check fails.
 *
 * @example
 * export default defineEventHandler({
 *   onRequest: [requireRelation('document', 'can_view', e => getRouterParam(e, 'id')!)],
 *   handler: async (event) => { ... },
 * })
 *
 * Contextual tuples are not included unless you pass `getContextualTuples`.
 * Pass `getAuthzContextualTuples` to use the same per-request tuples that
 * `/api/_authz/check` reads.
 */
export function requireRelation(
  objectType: string,
  relation: string,
  getObjectId: (event: H3Event) => string | Promise<string>,
  getContextualTuples?: (event: H3Event) => ContextualTupleKey[] | undefined | Promise<ContextualTupleKey[] | undefined>,
) {
  return defineEventHandler(async (event: H3Event) => {
    const userId = getAuthzUserId(event)
    if (!userId) {
      throw createError({ statusCode: 401, message: 'Authentication required' })
    }

    const objectId = await getObjectId(event)
    if (!objectId) {
      throw createError({ statusCode: 400, message: 'Object identifier required' })
    }

    const contextualTuples = getContextualTuples ? await getContextualTuples(event) : undefined
    await checkAccessOrThrow(userId, relation, objectType, objectId, { contextualTuples })
  })
}
