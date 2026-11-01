/**
 * Singleton memory store + OpenFgaClient-shaped shim.
 *
 * Activated by OPENFGA_MODE=memory. Caller must invoke
 * loadMemoryStore({ model, tuples }) before any authz operation;
 * useOpenFGAClient() then returns this shim instead of a real SDK
 * client. Process-lifetime only — no persistence. Safe for CI / tests
 * / dev-tooling; never reached in production with the default mode.
 */

import {
  evaluateCheck,
  evaluateListObjects,
  type AuthorizationModel,
  type MemoryTuple,
} from './memory-evaluator'
import { envValue } from './headers'

interface MemoryStore {
  model: AuthorizationModel
  tuples: MemoryTuple[]
}

let _store: MemoryStore | null = null

export function loadMemoryStore(state: { model: AuthorizationModel; tuples?: MemoryTuple[] }): void {
  _store = { model: state.model, tuples: [...(state.tuples ?? [])] }
}

export function resetMemoryStore(): void {
  _store = null
}

function requireStore(): MemoryStore {
  if (!_store) {
    throw new Error(
      '[nuxt-openfga] OPENFGA_MODE=memory but no memory store is loaded. '
      + 'Call loadMemoryStore({ model, tuples }) before any authz operation.',
    )
  }
  return _store
}

interface TupleKey { user: string; relation: string; object: string }

interface CheckRequest extends TupleKey {
  contextualTuples?: TupleKey[]
}

/**
 * Memory-backed shim implementing the subset of @openfga/sdk's
 * OpenFgaClient surface this module uses (check, listObjects, write).
 * Returned by useOpenFGAClient() when OPENFGA_MODE=memory. Cast to
 * `OpenFgaClient` at the call site — the runtime surface is stable for
 * the methods we exercise.
 */
export class MemoryFgaClient {
  async check(req: CheckRequest): Promise<{ allowed: boolean }> {
    const store = requireStore()
    const colonIdx = req.object.indexOf(':')
    const objectType = colonIdx === -1 ? req.object : req.object.slice(0, colonIdx)
    const objectId = colonIdx === -1 ? '' : req.object.slice(colonIdx + 1)
    // Contextual tuples are merged into the tuple set for this single
    // check only — same semantics as the upstream OpenFGA server. Never
    // mutated back into store.tuples.
    const tuples = req.contextualTuples && req.contextualTuples.length > 0
      ? [...store.tuples, ...req.contextualTuples]
      : store.tuples
    return {
      allowed: evaluateCheck(store.model, tuples, req.user, req.relation, objectType, objectId),
    }
  }

  async listObjects(req: { user: string; relation: string; type: string }): Promise<{ objects: string[] }> {
    const store = requireStore()
    return {
      objects: evaluateListObjects(store.model, store.tuples, req.user, req.relation, req.type),
    }
  }

  /**
   * Apply writes and deletes atomically, with OpenFGA's validation: writing a
   * tuple that already exists, or deleting one that does not, rejects the
   * whole request and changes nothing.
   */
  async write(req: { writes?: TupleKey[]; deletes?: TupleKey[] }): Promise<object> {
    const store = requireStore()
    const key = (t: TupleKey) => JSON.stringify([t.user, t.relation, t.object])
    const existing = new Set(store.tuples.map(key))

    for (const t of req.writes ?? []) {
      if (existing.has(key(t))) {
        throw new Error(`[nuxt-openfga] cannot write a tuple which already exists: ${t.user} ${t.relation} ${t.object}`)
      }
    }
    for (const t of req.deletes ?? []) {
      if (!existing.has(key(t))) {
        throw new Error(`[nuxt-openfga] cannot delete a tuple which does not exist: ${t.user} ${t.relation} ${t.object}`)
      }
    }

    const deleted = new Set((req.deletes ?? []).map(key))
    store.tuples = store.tuples.filter(t => !deleted.has(key(t)))
    for (const t of req.writes ?? []) {
      store.tuples.push({ user: t.user, relation: t.relation, object: t.object })
    }
    return {}
  }

}

export function isMemoryMode(): boolean {
  return envValue('OPENFGA_MODE') === 'memory'
}

// Re-exported so `@developmentsprint/nuxt-openfga/memory` offers the pure
// evaluator to unit tests that run outside Nuxt.
export { evaluateCheck, evaluateListObjects } from './memory-evaluator'
export type { AuthorizationModel, MemoryTuple, ObjectRef, TypeDefinition, Userset } from './memory-evaluator'
